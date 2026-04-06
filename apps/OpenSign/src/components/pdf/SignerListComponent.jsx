// Vibrant colors matching the signer circles in the LeaseLynx UI
const vibrantColors = [
  "#2563eb", // blue (Landlord)
  "#8b5cf6", // purple (Tenant)
  "#10b981", // emerald (Witness 1)
  "#06b6d4", // cyan (Witness 2)
  "#f59e0b", // amber
  "#ec4899", // pink
  "#ff00ff", // magenta
  "#00cc66", // green
  "#a855f7", // violet
  "#f97316", // orange
  "#0ea5e9", // sky
  "#eab308", // yellow
];

function SignerListComponent(props) {
  const isSigned = props.isSigned;

  // Look up the signer's color from signerPos
  const signerData = props.signerPos?.find(
    (s) =>
      s.Id === props.obj?.Id ||
      s.Id === props.obj?.objectId ||
      s.signerObjId === props.obj?.objectId ||
      (props.obj?.Role && s.Role === props.obj.Role)
  );
  const blockColor = signerData?.blockColor;

  // Map signer to vibrant color by their position in signerPos (same order as color assignment)
  const signerIndex = signerData ? props.signerPos?.indexOf(signerData) : -1;
  const cardColor = signerIndex >= 0 && signerIndex < vibrantColors.length
    ? vibrantColors[signerIndex]
    : blockColor;

  // Darken a hex color by multiplying RGB channels (solid color, no transparency)
  const darken = (hex, factor) => {
    if (!hex) return null;
    const h = hex.replace("#", "");
    const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
    const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
    const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);
    return `rgb(${r},${g},${b})`;
  };

  // Convert hex color to rgba with given alpha
  const toRgba = (hex, alpha) => {
    if (!hex) return null;
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const bgColor = toRgba(cardColor, 0.3) || "rgba(255,255,255,0.06)";
  const borderColor = toRgba(cardColor, 0.4) || "rgba(255,255,255,0.08)";

  return (
    <div
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: "0.5rem",
        marginLeft: "0.5rem",
        marginRight: "0.5rem",
        marginTop: "0.5rem",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <div style={{ flexShrink: 0, marginRight: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: isSigned
              ? darken("#10b981", 0.3) || "rgba(16,185,129,0.15)"
              : darken(cardColor, 0.3) || "rgba(255,255,255,0.1)",
            border: isSigned ? "2px solid #10b981" : `2px solid ${cardColor || "rgba(255,255,255,0.2)"}`,
          }}
        >
          {isSigned ? (
            <i className="fa-solid fa-check text-success text-sm"></i>
          ) : (
            <i
              className="fa-light fa-arrow-right text-sm"
              style={{ color: "#fb923c" }}
            ></i>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <span className="text-[13px] font-semibold text-base-content truncate">
          {props.obj?.Name || props?.obj?.Role}
        </span>
        <span className="text-[11px] text-base-content/50 truncate">
          {props.obj?.Role || props.obj?.Email || props.obj?.email}
        </span>
      </div>
    </div>
  );
}

export default SignerListComponent;
