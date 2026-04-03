import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import AgreementContent from "./AgreementContent";

function AgreementSign(props) {
  const { t } = useTranslation();
  const [isShowAgreeTerms, setIsShowAgreeTerms] = useState(false);

  return (
    <>
      <div className="op-modal op-modal-open absolute z-[448]">
        {/* Dark overlay */}
        <div className="fixed inset-0 bg-black/50" />
        {/* Modal card */}
        <div className="relative z-10 w-[95%] md:w-[60%] lg:w-[420px] overflow-y-auto hide-scrollbar"
             style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '32px', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
          {/* Logo */}
          <div style={{ marginBottom: '24px' }}>
            <img src="https://leaselynx.co.za/logo-LeaseLynx.png" height="50" alt="LeaseLynx" style={{ display: 'block' }} />
          </div>
          {/* Label + Heading */}
          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 800, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Electronic Signature</p>
          <h2 style={{ margin: '0 0 20px', fontSize: '20px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.3px' }}>Review &amp; Sign Agreement</h2>
          {/* Agreement text panel */}
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: '1.7' }}>
              <span>{t("agree-p1")}</span>
              <span
                style={{ color: '#60a5fa', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => { setIsShowAgreeTerms(true); }}
              >
                {" "}{t("agree-p2")}
              </span>
              <span> {t("agree-p3")}</span>
            </p>
          </div>
          {/* Note */}
          <p style={{ margin: '0 0 20px', fontSize: '11px', color: '#475569', lineHeight: '1.5' }}>
            {t("agreement-note")}
          </p>
          {/* CTA Button */}
          <button
            onClick={() => {
              props.setIsAgree(true);
              props.showFirstWidget();
            }}
            style={{ width: '100%', background: '#2563eb', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', letterSpacing: '0.03em', textTransform: 'uppercase' }}
          >
            I Agree — Continue to Document
          </button>
        </div>
      </div>
      {isShowAgreeTerms && (
        <AgreementContent
          setIsAgree={props.setIsAgree}
          setIsShowAgreeTerms={setIsShowAgreeTerms}
          showFirstWidget={props.showFirstWidget}
        />
      )}
    </>
  );
}

export default AgreementSign;
