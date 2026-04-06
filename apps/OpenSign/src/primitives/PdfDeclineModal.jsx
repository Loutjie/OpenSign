import React, { useState } from "react";
import "../styles/signature.css";
import { useTranslation } from "react-i18next";
import Loader from "./Loader";

function CustomModal(props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [isExtendExpiry, setIsExtendExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const localuser = localStorage.getItem(
    `Parse/${localStorage.getItem("parseAppId")}/currentUser`
  );

  const currentUser = JSON.parse(localuser);
  const isCreator = props?.doc
    ? props?.doc?.CreatedBy?.objectId === currentUser?.objectId &&
      localStorage.getItem("_user_role") !== "Guest"
    : false;
  const handleExtendBtn = () => setIsExtendExpiry(!isExtendExpiry);

  const handleUpdateExpiry = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (expiryDate) {
      props.handleExpiry && props.handleExpiry(expiryDate);
    } else {
      alert(t("expiry-date-error"));
    }
  };

  // Determine if this is a decline (red) or expired (orange) modal
  const isDeclineModal = props.footerMessage || props?.headMsg === t("document-declined");
  const accentColor = isDeclineModal ? "#ef4444" : "#fb923c";
  const iconClass = isDeclineModal ? "fa-solid fa-xmark" : "fa-solid fa-clock";

  return (
    props.show && (
      <dialog className="op-modal op-modal-open absolute z-[448]">
        <div
          className="w-[95%] md:w-[440px] op-modal-box p-0 overflow-y-auto hide-scrollbar text-sm"
          style={{
            backgroundColor: "#0f172a",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "0.75rem",
          }}
        >
          {props?.isLoader && (
            <div className="absolute h-full w-full flex flex-col justify-center items-center z-[999] bg-base-100/80 rounded-xl">
              <Loader />
            </div>
          )}

          <div className="flex flex-col items-center text-center px-6 pt-8 pb-2">
            {/* Icon circle */}
            <div
              className="w-[56px] h-[56px] rounded-full flex items-center justify-center mb-4"
              style={{
                backgroundColor: `${accentColor}15`,
                border: `2px solid ${accentColor}40`,
              }}
            >
              <i className={`${iconClass} text-xl`} style={{ color: accentColor }}></i>
            </div>

            {/* Heading */}
            <h3 className="text-base-content font-bold text-lg mb-2">
              {props?.headMsg}
            </h3>

            {/* Body message */}
            {!isExtendExpiry && props.bodyMssg && (
              <p className="text-sm text-base-content/60 mb-4">
                {props.bodyMssg}
              </p>
            )}
          </div>

          {/* Decline confirmation: reason textarea + yes/close buttons */}
          {props.footerMessage && !isExtendExpiry && (
            <div className="px-6 pb-6">
              <textarea
                rows={3}
                placeholder="Reason (optional)"
                className="w-full px-4 py-3 rounded-lg text-sm text-base-content focus:outline-none"
                style={{
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              ></textarea>
              <div className="flex gap-3 mt-4">
                <button
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white"
                  style={{ backgroundColor: "#ef4444" }}
                  type="button"
                  onClick={() => {
                    props.declineDoc(reason);
                    setReason("");
                  }}
                >
                  {t("yes")}, {t("decline") || "Decline"}
                </button>
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-lg font-medium text-sm text-base-content"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                  onClick={() => {
                    setReason("");
                    props.setIsDecline({ isDeclined: false });
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}

          {/* Expired: action buttons */}
          {!props.footerMessage && !isExtendExpiry && (
            <div className="flex flex-col gap-3 px-6 pb-6">
              {isCreator && (
                <button
                  className="w-full py-2.5 rounded-lg font-semibold text-sm text-white"
                  style={{ backgroundColor: "#2563eb" }}
                  onClick={() => handleExtendBtn()}
                >
                  {t("extend")}
                </button>
              )}
              {props.isDownloadBtn && (
                <button
                  className="w-full py-2.5 rounded-lg font-medium text-sm text-base-content"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                  onClick={() => props.handleDownloadBtn()}
                >
                  <i className="fa-light fa-arrow-down mr-2"></i>
                  {t("download")}
                </button>
              )}
            </div>
          )}

          {/* Extend expiry form */}
          {isExtendExpiry && (
            <form className="px-6 pb-6" onSubmit={handleUpdateExpiry}>
              <label
                htmlFor="expiryDate"
                className="text-sm text-base-content/70 mb-2 block"
              >
                {t("expiry-date")} {"(dd-mm-yyyy)"}
              </label>
              <input
                id="expiryDate"
                type="date"
                onClick={(e) => e?.currentTarget?.showPicker?.()}
                className="w-full px-4 py-2.5 rounded-lg text-sm text-base-content focus:outline-none"
                style={{
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                defaultValue={props?.doc?.ExpiryDate?.iso?.split("T")?.[0]}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
              <div className="flex gap-3 mt-4">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white"
                  style={{ backgroundColor: "#2563eb" }}
                >
                  {t("update")}
                </button>
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-lg font-medium text-sm text-base-content"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                  onClick={() => {
                    setExpiryDate("");
                    setIsExtendExpiry(false);
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    )
  );
}

export default CustomModal;
