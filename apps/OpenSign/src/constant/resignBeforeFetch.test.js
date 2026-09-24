// A URL loaded with a page carries a 900 s signature. Helpers that fetch it again later
// must first re-sign it through `getsignedurl`, naming the document or template that
// references the file (the server signs nothing else, #12), and then fetch the fresh URL.
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("axios", () => ({ default: { post: (...args) => post(...args) } }));
vi.mock("parse", () => ({ default: { Cloud: { run: vi.fn() } } }));
vi.mock("../i18n", () => ({ default: { t: (key) => key } }));
const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
});
const fetchMock = vi.fn();
vi.stubGlobal("fetch", (...args) => fetchMock(...args));

import { handleDownloadCertificate } from "./Utils";
import { handleCheckPrefillCreateDoc } from "../utils/prefillUtils";

const BUCKET = "https://storage.googleapis.com/leaselynx-opensign-files";
const OLD_SIG = "?X-Amz-Date=20260924T000000Z&X-Amz-Signature=old";
const NEW_SIG = "?X-Amz-Date=20260924T010000Z&X-Amz-Signature=new";
const stale = (key) => `${BUCKET}/${key}${OLD_SIG}`;
const fresh = (key) => `${BUCKET}/${key}${NEW_SIG}`;

const isSignCall = (url) => url.endsWith("/functions/getsignedurl");
const signCalls = () => post.mock.calls.filter(([url]) => isSignCall(url));

beforeEach(() => {
  post.mockReset();
  fetchMock.mockReset();
  store.clear();
  store.set("baseUrl", "https://signing-api.leaselynx.co.za/app/");
  // getsignedurl answers with the same key under a new signature.
  post.mockImplementation(async (url, body) => ({
    data: { result: isSignCall(url) ? body.url.replace(OLD_SIG, NEW_SIG) : null }
  }));
});

describe("handleDownloadCertificate", () => {
  it("re-signs the certificate against its document before handing it out", async () => {
    const pdfDetails = [{ objectId: "doc1", CertificateUrl: stale("cert.pdf") }];
    const url = await handleDownloadCertificate(pdfDetails, vi.fn(), true);
    expect(url).toBe(fresh("cert.pdf"));
    expect(signCalls()).toHaveLength(1);
    expect(signCalls()[0][1]).toEqual({ url: stale("cert.pdf"), docId: "doc1", templateId: "" });
  });
});

describe("handleCheckPrefillCreateDoc", () => {
  it("re-signs the template PDF against the template before fetching it", async () => {
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    // An unfilled required prefill widget returns right after the fetch, before
    // createDocument, which needs a live Parse server.
    const xyPosition = [
      {
        Role: "prefill",
        placeHolder: [{ pos: [{ key: 1, options: { name: "n", status: "required" } }] }]
      }
    ];
    const pdfDetails = [{ objectId: "tpl1", URL: stale("lease.pdf") }];
    const res = await handleCheckPrefillCreateDoc(
      xyPosition, [], vi.fn(), 1, stale("lease.pdf"), pdfDetails, [], "u1"
    );
    expect(res?.status).toBe("unfilled");
    expect(signCalls()).toHaveLength(1);
    expect(signCalls()[0][1]).toEqual({ url: stale("lease.pdf"), docId: "", templateId: "tpl1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(fresh("lease.pdf"));
  });
});
