// The success page reads the signed PDF once on load. `docurl` in its query string was
// signed when the signer finished and goes stale: its signature lapses, and a later
// signer's signature replaces the file, which getsignedurl then refuses (#12). With a
// `docid` the page loads the document's current file instead, which the server's
// afterFind has just signed, and re-signs `docurl` only when that load fails.
import { render, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const contractDocument = vi.fn();
const getSignedUrl = vi.fn();
const getBase64FromUrl = vi.fn();
const handleDownloadPdf = vi.fn();
vi.mock("../constant/Utils", () => ({
  contractDocument: (...a) => contractDocument(...a),
  getSignedUrl: (...a) => getSignedUrl(...a),
  getBase64FromUrl: (...a) => getBase64FromUrl(...a),
  handleDownloadPdf: (...a) => handleDownloadPdf(...a),
  handleDownloadCertificate: vi.fn(),
  handleToPrint: vi.fn()
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: {} })
}));
vi.mock("react-confetti", () => ({ default: () => null }));
vi.mock("../primitives/ModalUi", () => ({ default: () => null }));
vi.mock("../primitives/Loader", () => ({ default: () => null }));
vi.mock("../primitives/DownloadPdfZip", () => ({ default: () => null }));

import DocSuccessPage from "./DocSuccessPage";

const BUCKET = "https://storage.googleapis.com/leaselynx-opensign-files";
const STALE = `${BUCKET}/v1_lease.pdf?X-Amz-Signature=old`;
const CURRENT = `${BUCKET}/v2_lease.pdf?X-Amz-Signature=current`;
const RESIGNED = `${BUCKET}/v1_lease.pdf?X-Amz-Signature=new`;

const openAt = (query) => window.history.pushState({}, "", `/success?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  getSignedUrl.mockResolvedValue(RESIGNED);
  getBase64FromUrl.mockResolvedValue("JVBERi0=");
});

describe("DocSuccessPage", () => {
  it("reads the document's current file by docid, not docurl", async () => {
    contractDocument.mockResolvedValue([{ objectId: "d1", SignedUrl: CURRENT, URL: `${BUCKET}/v0.pdf` }]);
    openAt(`docid=d1&docurl=${encodeURIComponent(STALE)}`);
    const { getByText } = render(<DocSuccessPage />);

    await waitFor(() => expect(getBase64FromUrl).toHaveBeenCalledWith(CURRENT));
    expect(contractDocument).toHaveBeenCalledWith("d1");
    expect(getSignedUrl).not.toHaveBeenCalled();
    // The download button hands on the current file too.
    fireEvent.click(getByText("Download Signed PDF"));
    expect(handleDownloadPdf.mock.calls[0][0][0]).toMatchObject({ objectId: "d1", SignedUrl: CURRENT });
  });

  it("re-signs docurl against docid when the document cannot be loaded", async () => {
    // contractDocument reports failure as { result: { error } } or a string, never a throw.
    contractDocument.mockResolvedValue({ result: { error: "document deleted or you don't have access." } });
    openAt(`docid=d1&docurl=${encodeURIComponent(STALE)}`);
    render(<DocSuccessPage />);

    await waitFor(() => expect(getBase64FromUrl).toHaveBeenCalledWith(RESIGNED));
    expect(getSignedUrl).toHaveBeenCalledWith(STALE, "d1");
  });
});
