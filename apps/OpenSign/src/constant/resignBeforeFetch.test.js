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
const alertMock = vi.fn();
vi.stubGlobal("alert", alertMock);
const saveAs = vi.fn();
vi.mock("file-saver", () => ({ saveAs: (...a) => saveAs(...a) }));

import { downloadDocumentFile, getBase64FromUrl, handleDownloadCertificate } from "./Utils";
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
  alertMock.mockReset();
  saveAs.mockReset();
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

  // No CertificateUrl on the loaded document: the certificate comes from getDocument,
  // or failing that from generatecertificate, and is still re-signed against docId.
  const certFrom = ({ getDocument, generate }) =>
    post.mockImplementation(async (url, body) => {
      if (isSignCall(url)) return { data: { result: body.url.replace(OLD_SIG, NEW_SIG) } };
      if (url.endsWith("/getDocument")) return { data: { result: { CertificateUrl: getDocument } } };
      if (url.endsWith("/generatecertificate")) return { data: { result: { CertificateUrl: generate } } };
      throw new Error(`unexpected ${url}`);
    });

  it("re-signs a certificate read by getDocument against the document", async () => {
    certFrom({ getDocument: stale("cert.pdf") });
    const url = await handleDownloadCertificate([{ objectId: "doc1" }], vi.fn(), true);
    expect(url).toBe(fresh("cert.pdf"));
    expect(signCalls()).toHaveLength(1);
    expect(signCalls()[0][1]).toEqual({ url: stale("cert.pdf"), docId: "doc1", templateId: "" });
  });

  it("re-signs a certificate from generatecertificate against the document", async () => {
    certFrom({ generate: stale("new-cert.pdf") });
    const url = await handleDownloadCertificate([{ objectId: "doc1" }], vi.fn(), true);
    expect(url).toBe(fresh("new-cert.pdf"));
    expect(signCalls()).toHaveLength(1);
    expect(signCalls()[0][1]).toEqual({ url: stale("new-cert.pdf"), docId: "doc1", templateId: "" });
  });

  it("returns null and alerts when the re-sign fails", async () => {
    post.mockRejectedValue(new Error("Request failed with status code 400"));
    const pdfDetails = [{ objectId: "doc1", CertificateUrl: stale("cert.pdf") }];
    const url = await handleDownloadCertificate(pdfDetails, vi.fn(), false);
    expect(url).toBeNull();
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
    expect(saveAs).not.toHaveBeenCalled();
  });

  it("returns null and alerts when the generated certificate cannot be read", async () => {
    certFrom({ generate: stale("new-cert.pdf") });
    fetchMock.mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob(["<Error/>"]) });
    const url = await handleDownloadCertificate([{ objectId: "doc1" }], vi.fn(), false);
    expect(url).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(fresh("new-cert.pdf"));
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
    expect(saveAs).not.toHaveBeenCalled();
  });
});

// PdfRequestFiles' download button.
describe("downloadDocumentFile", () => {
  it("re-signs the file against the document and downloads the fresh URL", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(["%PDF-"]) });
    const pdfDetails = [{ objectId: "doc1", SignedUrl: stale("signed.pdf"), URL: stale("lease.pdf") }];
    await downloadDocumentFile(pdfDetails, "Lease.pdf");
    expect(signCalls()).toHaveLength(1);
    expect(signCalls()[0][1]).toEqual({ url: stale("signed.pdf"), docId: "doc1", templateId: "" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(fresh("signed.pdf"));
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), "Lease.pdf");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("alerts and fetches nothing when the re-sign fails", async () => {
    post.mockRejectedValue(new Error("Request failed with status code 400"));
    await downloadDocumentFile([{ objectId: "doc1", SignedUrl: stale("signed.pdf") }], "Lease.pdf");
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveAs).not.toHaveBeenCalled();
  });
});

describe("getBase64FromUrl", () => {
  it("rejects a 403 instead of encoding the error body", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob(["<Error/>"]) });
    await expect(getBase64FromUrl(stale("lease.pdf"))).rejects.toThrow("fetch 403");
  });

  it("encodes an OK response", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(["%PDF-"]) });
    await expect(getBase64FromUrl(fresh("lease.pdf"))).resolves.toBe(btoa("%PDF-"));
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

  // The report pages do not catch; a thrown re-sign would leave their loader stuck.
  // Falling back to the URL as loaded keeps the old behaviour: it may still be inside
  // its 900 s signature.
  it("falls back to the URL as loaded when the re-sign fails", async () => {
    post.mockRejectedValue(new Error("Request failed with status code 400"));
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(stale("lease.pdf"));
  });
});
