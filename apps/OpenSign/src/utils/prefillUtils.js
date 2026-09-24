import { SaveFileSize } from "../constant/saveFileSize";
import {
  convertBase64ToFile,
  convertPdfArrayBuffer,
  createDocument,
  generatePdfName,
  embedWidgetsToDoc,
  randomId,
  getBase64FromUrl,
  getSignedUrl,
  drawWidget
} from "../constant/Utils";
import { PDFDocument } from "pdf-lib";
import i18n from "../i18n";

export const prefillBlockColor = "transparent";
export const prefillObj = (id) => {
  const obj = {
    Id: id || randomId(),
    Role: "prefill",
    Name: "Prefill by owner",
    blockColor: prefillBlockColor
  };

  return obj;
};
//funtion to use embed prefill details in documentAdd commentMore actions
// Returns the new file's URL, or `{ error }`; never undefined. Callers alert and stop
// on `{ error }`: sending the template without its prefill values is never a fallback.
export const handleEmbedPrefillToDoc = async (
  prefillDetails,
  scale,
  pdfArrayBuffer,
  prefillImg,
  userId
) => {
  try {
    const placeholder = prefillDetails?.placeHolder;
    const existingPdfBytes = pdfArrayBuffer;
    const pdfDoc = await PDFDocument.load(existingPdfBytes, {
      ignoreEncryption: true
    });
    const isSignYourSelfFlow = false;
    try {
      const pdfBase64 = await embedWidgetsToDoc(
        placeholder,
        pdfDoc,
        isSignYourSelfFlow,
        scale,
        prefillImg
      );
      if (pdfBase64?.error) {
        return { error: pdfBase64.error };
      }
      const pdfName = generatePdfName(16);
      const pdfUrl = await convertBase64ToFile(pdfName, pdfBase64);
      const tenantId = localStorage.getItem("TenantId");
      const buffer = atob(pdfBase64);
      SaveFileSize(buffer.length, pdfUrl, tenantId, userId);
      if (!pdfUrl) {
        return { error: "prefill file was not saved" };
      }
      return pdfUrl;
    } catch (err) {
      console.log("error to convertBase64ToFile in placeholder flow", err);
      return { error: err?.message || "prefill embed failed" };
    }
  } catch (err) {
    console.log("error in handleEmbedPrefillToDoc function", err);
    return { error: err?.message || "prefill embed failed" };
  }
};
//this function is used to open modal to show signers list
export const handleDisplaySignerList = async (
  xyPosition,
  signers,
  setForms,
  isHideSigner
) => {
  //'isHideSigner' is used to check should signer attach dropdown display or not
  if (!isHideSigner) {
    // if any role does not attach signer then show signers list attach to role in modal
    const filterPrefill = xyPosition?.filter((x) => x.Role !== "prefill");
    let users = [];
    filterPrefill?.forEach((element) => {
      let label = "";
      const signerData = signers?.find(
        (x) => element.signerObjId && element.signerObjId === x.objectId
      );
      if (signerData) {
        label = `${signerData.Name}<${signerData.Email}>`;
      }
      users = [
        ...users,
        {
          value: element?.signerObjId || element?.Id,
          label: label || "",
          role: element.Role
        }
      ];
    });
    setForms(users);
  }
};

export const isValidPrefill = (prefillData) => {
  const getPlaceholder = prefillData?.placeHolder;
  if (getPlaceholder) {
    const uniqueWidgets = getPlaceholder
      .flatMap((page) => page.pos)
      .filter(
        (item, index, self) =>
          index ===
          self.findIndex((x) => x?.options?.name === item?.options?.name)
      );
    // Find objects with empty response of prefill widgets
    const emptyResponseObjects = uniqueWidgets.filter(
      (item) =>
        !item?.options?.defaultValue &&
        !item?.options?.response &&
        item?.options?.status === "required"
    );
    if (emptyResponseObjects.length > 0) {
      const res = {
        status: "unfilled",
        emptyResponseObjects: emptyResponseObjects
      };
      return res;
    }
  }
};
//function to use create document from templateAdd commentMore actions
export const handleCheckPrefillCreateDoc = async (
  xyPosition,
  signers,
  setIsPrefillModal,
  scale,
  updatedPdfUrl,
  pdfDetails,
  prefillImg,
  userId
) => {
  // `pdfDetails` is the template (every caller passes the getTemplate result), and
  // `updatedPdfUrl` is its URL, signed when the template was loaded or saved; the
  // signature may have lapsed while the user filled the modals. Re-sign it against
  // that template. createDocument still gets `updatedPdfUrl` as loaded, as before.
  // If the re-sign fails, fall back to the URL as loaded (it may still be inside its
  // 900 s signature): the report pages do not catch, and a throw here would leave
  // their loader stuck instead of creating the document as before. If that fetch
  // fails too, a template with prefill values returns `{ status: "error" }` below;
  // one without them never uses the bytes.
  const templateId = pdfDetails?.[0]?.objectId;
  let freshPdfUrl = updatedPdfUrl;
  try {
    freshPdfUrl = await getSignedUrl(updatedPdfUrl, "", templateId);
  } catch (err) {
    console.error("err in getsignedurl, using the URL as loaded", err);
  }
  const pdfArrayBuffer = await convertPdfArrayBuffer(freshPdfUrl);
  const prefillData = xyPosition.find((x) => x.Role === "prefill");
  if (prefillData) {
    const res = isValidPrefill(prefillData);
    if (res) {
      return res;
    }
  }
  const removePrefill = xyPosition.filter((data) => data.Role !== "prefill");
  const isAllAttachSigner =
    removePrefill.length > 0 && removePrefill.every((x) => x?.signerObjId);
  if (isAllAttachSigner) {
    setIsPrefillModal(false);
    const prefillDetails = xyPosition.find((data) => data.Role === "prefill");
    let signedUrl;
    //condition to check prefill widgets exit or not if exist then embed prefill widgets value in template
    //and then create document
    if (prefillDetails) {
      // The prefill values exist only in the embedded copy. If the template could not
      // be read (a lapsed signature and a failed re-sign) or the embed failed, stop:
      // sending `updatedPdfUrl` would send the signers a template without them.
      const embedded =
        pdfArrayBuffer === "Error"
          ? { error: "template PDF could not be read" }
          : await handleEmbedPrefillToDoc(
              prefillDetails,
              scale,
              pdfArrayBuffer,
              prefillImg,
              userId
            ).catch((err) => ({ error: err?.message || "prefill embed failed" }));
      if (!embedded || typeof embedded !== "string") {
        console.error("prefill not embedded, document not sent", embedded?.error);
        alert(i18n.t("something-went-wrong-mssg"));
        return { status: "error", id: "something-went-wrong-mssg" };
      }
      signedUrl = embedded;
    } else {
      signedUrl = pdfDetails[0]?.URL;
    }
    const isSendDoc = true;
    const res = await createDocument(
      pdfDetails,
      xyPosition,
      signers,
      signedUrl || updatedPdfUrl,
      isSendDoc
    );
    if (res.status === "success") {
      return res;
    } else if (res.status === "error") {
      // Every `{ status: "error" }` from here has been shown to the user; the callers
      // only clear their loader.
      alert(i18n.t(res.id || "something-went-wrong-mssg"));
      return res;
    }
  } else {
    const res = { status: "unattach signer" };
    return res;
  }
};

//function is used to save prefill image base64 in local to display on document/template
export const savePrefillImg = async (Placeholders) => {
  const prefillData = Placeholders?.find((x) => x.Role === "prefill");
  if (prefillData) {
    const allImageFields = prefillData?.placeHolder.flatMap((p) =>
      p.pos.filter((item) => item.type === "image" || item.type === drawWidget)
    );
    const hasImageType = allImageFields.some(
      (p) => p.type === "image" || p.type === drawWidget
    );
    if (hasImageType) {
      const imgArr = [];
      for (const ph of prefillData?.placeHolder || []) {
        for (const pos of ph?.pos || []) {
          if (
            (pos?.type === "image" || pos?.type === drawWidget) &&
            pos?.options?.response
          ) {
            const addSuffix = true;
            const base64 = await getBase64FromUrl(
              pos?.options?.response,
              addSuffix
            );
            imgArr.push({ id: pos?.key, base64: base64 });
          } else if (pos?.type === "image" || pos?.type === drawWidget) {
            imgArr.push({ id: pos?.key, base64: "" });
          }
        }
      }

      return imgArr;
    }
  }
};

//function is used to get signers list for showing in modal
export const handleSignersList = (item) => {
  const removePrefill = item?.Placeholders?.filter((x) => x.Role !== "prefill");
  let updatedSigners = removePrefill.map((x) => {
    let matchingSigner = item?.Signers?.find(
      (y) => x.signerObjId && x.signerObjId === y.objectId
    );
    if (matchingSigner) {
      return {
        ...matchingSigner,
        Role: x.Role ? x.Role : matchingSigner.Role,
        Id: x.Id,
        blockColor: x.blockColor
      };
    } else {
      return { Role: x.Role, Id: x.Id, blockColor: x.blockColor };
    }
  });
  return updatedSigners;
};

export const normalizeKey = (value) => value?.trim()?.toLowerCase() || "";
