import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Confetti from "react-confetti"; // Import the confetti library
import {
  getBase64FromUrl,
  handleDownloadCertificate,
  handleDownloadPdf,
  handleToPrint,
} from "../constant/Utils";
import ModalUi from "../primitives/ModalUi";
import Loader from "../primitives/Loader";
import DownloadPdfZip from "../primitives/DownloadPdfZip";

const DocSuccessPage = () => {
  const { t } = useTranslation();
  const signed = window.location?.search?.includes("docid");
  const sent = window.location?.search?.includes("message");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadModal, setIsDownloadModal] = useState(false);
  const [pdfDetails, setPdfDetails] = useState([]);
  const [pdfBase64Url, setPdfBase64Url] = useState("");
  const [showConfetti, setShowConfetti] = useState(true); // State to control confetti

  useEffect(() => {
    initialsetup();
    // Stop confetti after 5 seconds
    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const initialsetup = async () => {
    const search = window.location.search.split("?")[1];
    if (search) {
      const urlParams = new URLSearchParams(search);
      const docId = urlParams.get("docid");
      const docUrl = urlParams.get("docurl");
      const certificate = urlParams.get("certificate");
      const completed = urlParams?.get("completed") || false;
      const details = {
        objectId: docId,
        SignedUrl: docUrl,
        CertificateUrl: certificate,
        IsCompleted: completed,
      };
      setPdfDetails([details]);
      const base64Pdf = await getBase64FromUrl(docUrl);
      if (base64Pdf) {
        setPdfBase64Url(base64Pdf);
      }
    }
  };

  const handleDownload = () => {
    if (
      pdfDetails?.[0]?.IsCompleted
    ) {
      setIsDownloadModal(true);
    } else {
      handleDownloadPdf(pdfDetails, setIsDownloading, pdfBase64Url);
    }
  };

  return (
    <>
      {/* Confetti Effect */}
      {showConfetti && (
        <Confetti width={window.innerWidth} height={window.innerHeight} />
      )}
      {sent ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-3 md:p-8 text-center bg-base-100">
          <div className="max-w-lg md:max-w-2xl bg-base-200 rounded-xl border !border-[rgba(255,255,255,0.08)] p-3 md:p-10">
            <span className="text-base-content">{t("doc-sent")}</span>
          </div>
        </div>
      ) : signed ? (
        <>
          <div className="min-h-screen flex flex-col items-center justify-center p-3 md:p-8 text-center bg-base-100">
            <div className="max-w-md w-full bg-base-200 rounded-xl border !border-[rgba(255,255,255,0.08)] px-8 py-10">
              <div className="flex flex-col items-center">
                {/* Green check circle */}
                <div className="w-[72px] h-[72px] rounded-full bg-success/15 border-2 border-success/40 flex items-center justify-center mb-5">
                  <i className="fa-solid fa-check text-success text-2xl"></i>
                </div>
                {/* Label + heading */}
                <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#fb923c] mb-1">
                  Signing Complete
                </span>
                <h1 className="text-xl font-bold text-base-content mb-2">
                  {t("document-signed")}
                </h1>
                <p className="text-sm text-base-content/50 mb-6">
                  You will receive a copy of the signed document via email.
                </p>
              </div>
              {/* Action buttons — stacked full-width */}
              <div className="flex flex-col gap-3 w-full">
                <button
                  type="button"
                  className="w-full py-3 rounded-lg bg-primary text-primary-content font-semibold text-sm flex items-center justify-center gap-2"
                  onClick={() => handleDownload()}
                >
                  <i className="fa-light fa-arrow-down"></i>
                  Download Signed PDF
                </button>
                {pdfDetails?.[0]?.IsCompleted && (
                  <button
                    type="button"
                    className="w-full py-3 rounded-lg bg-base-300/60 border !border-[rgba(255,255,255,0.08)] text-base-content font-medium text-sm flex items-center justify-center gap-2"
                    onClick={() =>
                      handleDownloadCertificate(pdfDetails, setIsDownloading)
                    }
                  >
                    <span>🏆</span>
                    Download Certificate
                  </button>
                )}
                <button
                  type="button"
                  className="w-full py-3 rounded-lg bg-base-300/60 border !border-[rgba(255,255,255,0.08)] text-base-content font-medium text-sm flex items-center justify-center gap-2"
                  onClick={(e) =>
                    handleToPrint(e, setIsDownloading, pdfDetails)
                  }
                >
                  <i className="fa-light fa-print"></i>
                  {t("print")}
                </button>
              </div>
              {/* Footer */}
              <p className="text-xs text-base-content/30 mt-6">
                Powered by <span className="text-primary/60">LeaseLynx</span>
              </p>
            </div>
          </div>
          {isDownloading === "pdf" && (
            <div className="fixed z-[1000] inset-0 flex justify-center items-center bg-black bg-opacity-30">
              <Loader />
            </div>
          )}
          <ModalUi
            isOpen={
              isDownloading === "certificate" ||
              isDownloading === "certificate_err"
            }
            title={
              isDownloading === "certificate" ||
              isDownloading === "certificate_err"
                ? t("generating-certificate")
                : t("pdf-download")
            }
            handleClose={() => setIsDownloading("")}
          >
            <div className="p-3 md:p-5 text-sm md:text-base text-center text-base-content">
              {isDownloading === "certificate" ? (
                <p>{t("generate-certificate-alert")}</p>
              ) : (
                <p>{t("generate-certificate-err")}</p>
              )}
            </div>
          </ModalUi>
          <DownloadPdfZip
            setIsDownloadModal={setIsDownloadModal}
            isDownloadModal={isDownloadModal}
            pdfDetails={pdfDetails}
            isDocId={true}
            pdfBase64={pdfBase64Url}
          />
        </>
      ) : (
        <></>
      )}
    </>
  );
};

export default DocSuccessPage;
