// The PDF + certificate ZIP must hold two PDFs. When the certificate URL is not
// available, fetch(null) would read the app's own HTML page and zip it as the
// certificate; the download must stop and alert instead.
import { render, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSignedUrl = vi.fn();
const handleDownloadCertificate = vi.fn();
vi.mock("../constant/Utils", () => ({
  getSignedUrl: (...a) => getSignedUrl(...a),
  handleDownloadCertificate: (...a) => handleDownloadCertificate(...a),
  handleDownloadPdf: vi.fn(),
  fileNameWithUnderscore: (n) => n
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: {} })
}));
vi.mock("./ModalUi", () => ({
  default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null)
}));
vi.mock("./Loader", () => ({ default: () => null }));
const saveAs = vi.fn();
vi.mock("file-saver", () => ({ saveAs: (...a) => saveAs(...a) }));
const fetchMock = vi.fn();
vi.stubGlobal("fetch", (...a) => fetchMock(...a));
const alertMock = vi.fn();
vi.stubGlobal("alert", alertMock);

import DownloadPdfZip from "./DownloadPdfZip";

const SIGNED = "https://storage.googleapis.com/leaselynx-opensign-files/signed.pdf?X-Amz-Signature=s";
const pdfResponse = () => ({ ok: true, status: 200, blob: async () => new Blob(["%PDF-"]) });

const downloadZip = () => {
  const { getByText, getByLabelText } = render(
    <DownloadPdfZip
      isDownloadModal
      setIsDownloadModal={vi.fn()}
      pdfDetails={[{ objectId: "doc1", Name: "Lease", SignedUrl: SIGNED }]}
    />
  );
  fireEvent.click(getByLabelText("pdf-certificate"));
  fireEvent.click(getByText("download"));
};

beforeEach(() => {
  vi.clearAllMocks();
  getSignedUrl.mockResolvedValue(SIGNED);
  fetchMock.mockResolvedValue(pdfResponse());
});

describe("DownloadPdfZip, PDF and certificate", () => {
  it("zips both PDFs when the certificate URL is available", async () => {
    handleDownloadCertificate.mockResolvedValue("https://storage.googleapis.com/leaselynx-opensign-files/cert.pdf?X-Amz-Signature=c");
    downloadZip();
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("refuses a falsy certificate URL: no fetch of it, no ZIP, an alert", async () => {
    handleDownloadCertificate.mockResolvedValue(null);
    downloadZip();
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("something-went-wrong-mssg"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(SIGNED);
    expect(saveAs).not.toHaveBeenCalled();
  });
});
