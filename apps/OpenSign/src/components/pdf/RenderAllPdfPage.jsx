import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document } from "react-pdf";
import { useSelector } from "react-redux";
import { PDFDocument } from "pdf-lib";
import {
  base64ToArrayBuffer,
  decryptPdf,
  flattenPdf,
  getFileAsArrayBuffer
} from "../../constant/Utils";
import { maxFileSize } from "../../constant/const";

function RenderAllPdfPage(props) {
  const { t } = useTranslation();
  const pageContainer = useRef();
  const mergePdfInputRef = useRef(null);
  const [signPageNumber, setSignPageNumber] = useState([]);
  const [bookmarkColor, setBookmarkColor] = useState("");
  const isSidebar = useSelector((state) => state.sidebar.isOpen);
  const [pageWidth, setPageWidth] = useState(""); // kept for sidebar resize logic

  //set all number of pages after load pdf
  function onDocumentLoad({ numPages }) {
    props?.setAllPages(numPages);
    //check if signerPos array exist then save page number exist in signerPos array to show bookmark icon
    if (props?.signerPos) {
      const checkUser = props?.signerPos.filter(
        (data) => data.Id === props?.id
      );
      setBookmarkColor(checkUser[0]?.blockColor);
      let pageNumberArr = [];
      if (checkUser?.length > 0) {
        checkUser[0]?.placeHolder?.map((data) => {
          pageNumberArr.push(data?.pageNumber);
        });

        setSignPageNumber(pageNumberArr);
      }
    }
  }

  useEffect(() => {
    const updateSize = () => {
      if (pageContainer.current) {
        setPageWidth(pageContainer.current.offsetWidth);
      }
    };

    // Use setTimeout to wait for the transition to complete
    const timer = setTimeout(updateSize, 150); // match the transition duration

    return () => clearTimeout(timer);
  }, [isSidebar, pageContainer, props?.containerWH]);
  //'function `addSignatureBookmark` is used to display the page where the user's signature is located.
  const addSignatureBookmark = (index) => {
    const ispageNumber = signPageNumber.includes(index + 1);
    return (
      ispageNumber && (
        <div className="absolute z-20 top-[1px] -right-[13px] -translate-x-1/2 -translate-y-1/2">
          <i
            style={{ color: bookmarkColor || "red" }}
            className="fa-solid fa-bookmark"
          ></i>
        </div>
      )
    );
  };
  const pdfDataBase64 = `data:application/pdf;base64,${props?.pdfBase64Url}`;

  // `removeFile` is used to  remove file if exists
  const removeFile = (e) => {
    if (e) {
      e.target.value = "";
    }
  };
  // `handleFileUpload` is trigger when user click on add pages btn and is used to merge multiple pdf
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) {
      alert(t("please-select-pdf"));
      return;
    }
    if (!file.type.includes("pdf")) {
      alert(t("only-pdf-allowed"));
      return;
    }
    const fileSize =
      maxFileSize;
    const pdfsize = file?.size;
    const fileSizeBytes = fileSize * 1024 * 1024;
    if (pdfsize > fileSizeBytes) {
      alert(`${t("file-alert-1")} ${fileSize} MB`);
      removeFile(e);
      return;
    }
    try {
      let uploadedPdfBytes = await file.arrayBuffer();
      try {
        uploadedPdfBytes = await flattenPdf(uploadedPdfBytes);
      } catch (err) {
        if (err?.message?.includes("is encrypted")) {
          try {
            const pdfFile = await decryptPdf(file, "");
            const pdfArrayBuffer = await getFileAsArrayBuffer(pdfFile);
            uploadedPdfBytes = await flattenPdf(pdfArrayBuffer);
          } catch (err) {
            if (err?.response?.status === 401) {
              const password = prompt(
                `PDF "${file.name}" is password-protected. Enter password:`
              );
              if (password) {
                try {
                  const pdfFile = await decryptPdf(file, password);
                  const pdfArrayBuffer = await getFileAsArrayBuffer(pdfFile);
                  uploadedPdfBytes = await flattenPdf(pdfArrayBuffer);
                  // Upload the file to Parse Server
                } catch (err) {
                  console.error("Incorrect password or decryption failed", err);
                  alert(t("incorrect-password-or-decryption-failed"));
                }
              } else {
                alert(t("provide-password"));
              }
            } else {
              console.log("Err ", err);
              alert(t("error-uploading-pdf"));
            }
          }
        } else {
          alert(t("error-uploading-pdf"));
        }
      }
      const uploadedPdfDoc = await PDFDocument.load(uploadedPdfBytes, {
        ignoreEncryption: true
      });
      const basePdfDoc = await PDFDocument.load(props.pdfArrayBuffer);

      // Copy pages from the uploaded PDF to the base PDF
      const uploadedPdfPages = await basePdfDoc.copyPages(
        uploadedPdfDoc,
        uploadedPdfDoc.getPageIndices()
      );
      uploadedPdfPages.forEach((page) => basePdfDoc.addPage(page));
      // Save the updated PDF
      const pdfBase64 = await basePdfDoc.saveAsBase64({
        useObjectStreams: false
      });
      const pdfBuffer = base64ToArrayBuffer(pdfBase64);
      const pdfsize = pdfBuffer?.byteLength;
      const fileSizeBytes = fileSize * 1024 * 1024;
      if (pdfsize > fileSizeBytes) {
        alert(`${t("file-alert-1")} ${fileSize} MB`);
        removeFile(e);
        return;
      }
      props.setPdfArrayBuffer(pdfBuffer);
      props.setPdfBase64Url(pdfBase64);
      props.setIsUploadPdf && props.setIsUploadPdf(true);
      mergePdfInputRef.current.value = "";
    } catch (error) {
      mergePdfInputRef.current.value = "";
      console.error("Error merging PDF:", error);
    }
  };
  return (
    <div ref={pageContainer} className="hidden w-[60px] bg-base-100 md:flex flex-col items-center pt-4 border-r !border-[rgba(255,255,255,0.08)]">
      <div
        className="flex flex-col items-center gap-2 overflow-y-auto hide-scrollbar max-h-[calc(100vh-80px)] py-2"
      >
        <Document
          error=""
          loading={""}
          onLoadSuccess={onDocumentLoad}
          file={pdfDataBase64}
        >
          {Array.from(new Array(props?.allPages), (el, index) => (
            <div
              key={index}
              className={`${
                props?.pageNumber - 1 === index
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:border-base-content/30"
              } border-2 rounded-md w-[40px] h-[52px] flex justify-center items-center cursor-pointer transition-colors relative`}
              onClick={() => {
                props?.setPageNumber(index + 1);
                if (props?.setSignBtnPosition) {
                  props?.setSignBtnPosition([]);
                }
              }}
            >
              {props?.signerPos && addSignatureBookmark(index)}
              <span className={`text-xs font-medium ${
                props?.pageNumber - 1 === index
                  ? "text-primary"
                  : "text-base-content/60"
              }`}>
                {index + 1}
              </span>
            </div>
          ))}
        </Document>
        {props?.isMergePdfBtn && (
          <button
            className="w-[40px] h-[40px] flex justify-center items-center rounded-md border border-dashed border-base-content/30 hover:border-primary/50 transition-colors"
            onClick={() => mergePdfInputRef.current.click()}
            title={t("add-pages")}
          >
            <input
              type="file"
              className="hidden"
              accept="application/pdf"
              ref={mergePdfInputRef}
              onChange={handleFileUpload}
            />
            <i className="fa-light fa-plus text-base-content/50 text-xs"></i>
          </button>
        )}
      </div>
    </div>
  );
}

export default RenderAllPdfPage;
