// "Done" on the signer's last widget is the only save for the value just given. These
// tests render the modal inside a parent that mounts it the way PdfRequestFiles does
// (keyed on the open widget, and only while it is open), because clearing the open
// widget unmounts the modal and would throw the finish state away.
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Provider, useSelector } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";
import widgetReducer from "../../redux/reducers/widgetSlice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: {} })
}));
vi.mock("../../i18n", () => ({ default: { t: (key) => key } }));
vi.mock("@imgly/background-removal", () => ({ removeBackground: vi.fn() }));
vi.mock("../../primitives/ModalUi", () => ({
  default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null)
}));
vi.mock("../../primitives/Loader", () => ({ default: () => null }));
// The draw pad needs a real canvas; the stub hands the modal a drawn image on click.
const DRAWN_IMG = "data:image/png;base64,RFJBV04=";
vi.mock("./tab/Draw", () => ({
  default: ({ handleSignatureChange }) => (
    <button type="button" onClick={() => handleSignatureChange(DRAWN_IMG)}>
      stub-draw
    </button>
  )
}));
const saveToMySign = vi.fn();
vi.mock("../../utils", () => ({
  saveToMySign: (...args) => saveToMySign(...args),
  getInitials: vi.fn(),
  isValidBase64: vi.fn()
}));

// jsdom has no canvas; a typed signature is drawn on one.
const TYPED_IMG = "data:image/png;base64,VFlQRUQ=";
HTMLCanvasElement.prototype.getContext = () =>
  new Proxy(
    {
      measureText: () => ({
        width: 100,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5
      })
    },
    { get: (target, prop) => (prop in target ? target[prop] : () => {}), set: () => true }
  );
HTMLCanvasElement.prototype.toDataURL = () => TYPED_IMG;
Object.defineProperty(document, "fonts", { value: { load: async () => [] } });

// This runtime's jsdom has no localStorage; the modal reads the session token from it.
const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
});
vi.stubGlobal("alert", vi.fn());

const { default: WidgetsValueModal } = await import("./WidgetsValueModal");
const { setIsShowModal, setSaveSignCheckbox } = await import(
  "../../redux/reducers/widgetSlice"
);

const SIGNER = "signer-1";
const signatureWidget = (options) => ({
  key: "w-sign",
  type: "signature",
  Width: 150,
  Height: 60,
  options: { name: "signature", ...options }
});

// Mirrors PdfRequestFiles: `isShowModal[currWidgetsDetails?.key] && <WidgetsValueModal key=… />`.
const TYPED_FIRST = [{ name: "typed", enabled: true }, { name: "draw", enabled: true }];
const DRAW_FIRST = [{ name: "draw", enabled: true }, { name: "typed", enabled: true }];

function Harness({ widget, signatureTypes, onPositions }) {
  const [signerPos, setSignerPos] = useState([
    { Id: SIGNER, placeHolder: [{ pageNumber: 1, pos: [widget] }] }
  ]);
  const [curr, setCurr] = useState(widget);
  const isShowModal = useSelector((state) => state.widget.isShowModal);
  onPositions(signerPos);
  return (
    isShowModal[curr?.key] && (
      <WidgetsValueModal
        key={curr?.key}
        xyPosition={signerPos}
        pageNumber={1}
        setXyPosition={setSignerPos}
        uniqueId={SIGNER}
        setPageNumber={() => {}}
        finishDocument={() => {}}
        setCurrWidgetsDetails={setCurr}
        currWidgetsDetails={curr}
        index={1}
        signatureTypes={signatureTypes}
      />
    )
  );
}

function renderModal(widget, { savedSignVisible = false, signatureTypes = TYPED_FIRST } = {}) {
  const reduxStore = configureStore({ reducer: { widget: widgetReducer } });
  reduxStore.dispatch(setIsShowModal({ [widget.key]: true }));
  if (savedSignVisible) {
    reduxStore.dispatch(setSaveSignCheckbox({ isVisible: true, signId: "" }));
  }
  let positions;
  render(
    <Provider store={reduxStore}>
      <Harness
        widget={widget}
        signatureTypes={signatureTypes}
        onPositions={(p) => (positions = p)}
      />
    </Provider>
  );
  const storedResponse = () => positions[0].placeHolder[0].pos[0].options.response;
  return { storedResponse };
}

const doneButton = () => screen.getByRole("button", { name: "done" });
const typeName = (name) =>
  fireEvent.change(screen.getByPlaceholderText("signature-type"), {
    target: { value: name }
  });

describe("WidgetsValueModal: Done on the last widget", () => {
  beforeEach(() => {
    store.clear();
    saveToMySign.mockReset();
  });

  it("keeps Done disabled until the signer gives a value", () => {
    renderModal(signatureWidget({ status: "required" }));
    expect(doneButton()).toBeDisabled();
    typeName("Tina Tenant");
    expect(doneButton()).toBeEnabled();
  });

  it("stores the typed value, then shows the finish state", async () => {
    const { storedResponse } = renderModal(signatureWidget({ status: "required" }));
    typeName("Tina Tenant");
    fireEvent.click(doneButton());
    await screen.findByText("All fields completed");
    expect(storedResponse()).toBe(TYPED_IMG);
  });

  it("waits for a 'save signature' request before storing and finishing", async () => {
    store.set("accesstoken", "session-token");
    let answerSave;
    saveToMySign.mockImplementation(
      () => new Promise((resolve) => (answerSave = resolve))
    );
    const { storedResponse } = renderModal(signatureWidget({ status: "required" }), {
      savedSignVisible: true,
      signatureTypes: DRAW_FIRST
    });
    fireEvent.click(screen.getByRole("button", { name: "stub-draw" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /save/ }));
    fireEvent.click(doneButton());

    expect(saveToMySign).toHaveBeenCalledTimes(1);
    // The save is still in flight: nothing stored, not finished.
    await act(async () => {});
    expect(screen.queryByText("All fields completed")).toBeNull();
    expect(storedResponse()).toBeUndefined();

    await act(async () => answerSave({ id: "sign-1", base64File: DRAWN_IMG }));
    await screen.findByText("All fields completed");
    expect(storedResponse()).toBe(DRAWN_IMG);
  });

  it("leaves an optional widget's existing response alone on Done with no new value", async () => {
    const existing = "data:image/png;base64,RVhJU1RJTkc=";
    const { storedResponse } = renderModal(
      signatureWidget({ status: "optional", response: existing })
    );
    expect(doneButton()).toBeEnabled();
    fireEvent.click(doneButton());
    await screen.findByText("All fields completed");
    expect(storedResponse()).toBe(existing);
  });
});
