// The signing link's fourth part is the sendmail flag (LeaseLynx sends `false`: it emails
// the next signer itself). GuestLogin must carry it to the signer page as ?sendmail=false,
// or the signer page emails the next signer a second time.
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let routeParams = {};
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => routeParams
}));
const cloudRun = vi.fn();
vi.mock("parse", () => ({
  default: { Cloud: { run: (...args) => cloudRun(...args) }, User: { become: vi.fn() } }
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: {} })
}));
vi.mock("../constant/Utils", () => ({
  contractUsers: vi.fn(),
  saveLanguageInLocal: vi.fn()
}));
vi.mock("../constant/appinfo", () => ({
  appInfo: { appId: "opensign", baseUrl: "https://sign.example/app" }
}));
vi.mock("../components/pdf/SelectLanguage", () => ({ default: () => null }));
vi.mock("../primitives/LoaderWithMsg", () => ({ default: () => null }));
vi.mock("../primitives/ModalUi", () => ({ default: () => null }));
vi.mock("../primitives/Loader", () => ({ default: () => null }));

// The page clears and fills localStorage on load; this runtime's jsdom has none.
const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
});

const { default: GuestLogin } = await import("./GuestLogin");

describe("GuestLogin sendmail flag", () => {
  beforeEach(() => {
    navigate.mockReset();
    cloudRun.mockReset();
    // A document without OTP: getDocument answers without a session, so the page
    // navigates on its first run.
    cloudRun.mockImplementation(async (name) =>
      name === "linkcontacttodoc" ? { contactId: "contact-9" } : { objectId: "doc-1" }
    );
  });

  it("keeps sendmail=false from the link when the document opens straight away", async () => {
    routeParams = { base64url: btoa("doc-1/tina@x.test/contact-1/false") };
    render(<GuestLogin />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/load/recipientSignPdf/doc-1/contact-1?sendmail=false");
  });

  it("keeps it for a signer known only by email (contact linked on the way)", async () => {
    routeParams = { base64url: btoa("doc-1/tina@x.test//false") };
    render(<GuestLogin />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/load/recipientSignPdf/doc-1/contact-9?sendmail=false");
  });

  it("adds nothing for a link without the flag (OpenSign's own mail)", async () => {
    routeParams = { base64url: btoa("doc-1/tina@x.test/contact-1") };
    render(<GuestLogin />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/load/recipientSignPdf/doc-1/contact-1");
  });
});
