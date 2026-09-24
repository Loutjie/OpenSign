// A template's prefill values reach the signers only through the copy that
// handleEmbedPrefillToDoc writes. When the template cannot be read or the embed fails,
// handleCheckPrefillCreateDoc must stop with `{ status: "error" }` and tell the user;
// it must never create the document from the unembedded template URL (#12).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const convertPdfArrayBuffer = vi.fn();
const embedWidgetsToDoc = vi.fn();
const convertBase64ToFile = vi.fn();
const createDocument = vi.fn();
const getSignedUrl = vi.fn();
vi.mock("../constant/Utils", () => ({
  convertPdfArrayBuffer: (...a) => convertPdfArrayBuffer(...a),
  embedWidgetsToDoc: (...a) => embedWidgetsToDoc(...a),
  convertBase64ToFile: (...a) => convertBase64ToFile(...a),
  createDocument: (...a) => createDocument(...a),
  getSignedUrl: (...a) => getSignedUrl(...a),
  generatePdfName: () => "name",
  randomId: () => 1,
  getBase64FromUrl: vi.fn(),
  drawWidget: "draw"
}));
vi.mock("../constant/saveFileSize", () => ({ SaveFileSize: vi.fn() }));
vi.mock("../i18n", () => ({ default: { t: (key) => key } }));

import { handleCheckPrefillCreateDoc } from "./prefillUtils";

const TEMPLATE_URL = "https://storage.googleapis.com/leaselynx-opensign-files/lease.pdf?X-Amz-Signature=s";
const EMBEDDED_URL = "https://storage.googleapis.com/leaselynx-opensign-files/prefilled.pdf?X-Amz-Signature=p";
const alertMock = vi.fn();
vi.stubGlobal("alert", alertMock);
vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });

// A template with a filled prefill widget and one role attached to a signer.
const xyPosition = [
  {
    Role: "prefill",
    placeHolder: [
      { pageNumber: 1, pos: [{ key: 1, type: "text", options: { name: "rent", response: "R 9 000" } }] }
    ]
  },
  { Role: "Tenant", Id: 2, signerObjId: "s1", placeHolder: [] }
];
const pdfDetails = [{ objectId: "tpl1", URL: TEMPLATE_URL }];
const send = () =>
  handleCheckPrefillCreateDoc(xyPosition, [{ objectId: "s1" }], vi.fn(), 1, TEMPLATE_URL, pdfDetails, [], "u1");

let pdfBytes;
beforeEach(async () => {
  vi.clearAllMocks();
  if (!pdfBytes) {
    const doc = await PDFDocument.create();
    doc.addPage();
    pdfBytes = await doc.save();
  }
  getSignedUrl.mockResolvedValue(TEMPLATE_URL);
  convertPdfArrayBuffer.mockResolvedValue(pdfBytes.slice().buffer);
  embedWidgetsToDoc.mockResolvedValue("JVBERi0=");
  convertBase64ToFile.mockResolvedValue(EMBEDDED_URL);
  createDocument.mockResolvedValue({ status: "success", id: "doc1" });
});

describe("handleCheckPrefillCreateDoc with prefill values", () => {
  it("creates the document from the embedded copy", async () => {
    const res = await send();
    expect(res).toEqual({ status: "success", id: "doc1" });
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][3]).toBe(EMBEDDED_URL);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("stops when the template cannot be read (a lapsed URL)", async () => {
    convertPdfArrayBuffer.mockResolvedValue("Error");
    const res = await send();
    expect(res?.status).toBe("error");
    expect(createDocument).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
  });

  it("stops when an image embed fails", async () => {
    // embedWidgetsToDoc answers a failed image embed with `{ error }`.
    embedWidgetsToDoc.mockResolvedValue({ error: "This pdf is not compatible" });
    const res = await send();
    expect(res?.status).toBe("error");
    expect(createDocument).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
  });

  it("stops when the embed throws", async () => {
    embedWidgetsToDoc.mockRejectedValue(new Error("font fetch failed"));
    const res = await send();
    expect(res?.status).toBe("error");
    expect(createDocument).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
  });

  it("stops when the embedded copy is not saved", async () => {
    convertBase64ToFile.mockResolvedValue(undefined);
    const res = await send();
    expect(res?.status).toBe("error");
    expect(createDocument).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg");
  });
});
