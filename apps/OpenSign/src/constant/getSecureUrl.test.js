// `getSecureUrl` runs after every upload. Only a local Parse file may go to `fileupload`:
// in S3 mode the server refuses one (#12), and a bucket URL already carries its
// upload-time signature, so it must come back untouched without a server call.
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudRun = vi.fn();
vi.mock("parse", () => ({
  default: { Cloud: { run: (...args) => cloudRun(...args) } }
}));
vi.mock("../i18n", () => ({ default: { t: (key) => key } }));
// This runtime's jsdom has no localStorage (see GuestLogin.test.jsx).
const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
});

import { getSecureUrl } from "./Utils";

const KEY = "c1a827bec10ab7baf3a156849d6487da_Lease_Tenant.pdf";

describe("getSecureUrl", () => {
  beforeEach(() => {
    cloudRun.mockReset();
    localStorage.setItem("baseUrl", "https://signing-api.leaselynx.co.za/app/");
  });

  it("returns a bucket URL as is, without calling fileupload", async () => {
    // "files" is in the bucket name; the old substring test sent this to fileupload.
    const url = `https://storage.googleapis.com/leaselynx-opensign-files/${KEY}?X-Amz-Signature=x`;
    await expect(getSecureUrl(url)).resolves.toEqual({ url });
    expect(cloudRun).not.toHaveBeenCalled();
  });

  it("sends a local Parse file URL to fileupload for a token", async () => {
    const url = `https://signing-api.leaselynx.co.za/app/files/opensign/${KEY}`;
    cloudRun.mockResolvedValue({ url: `${url}?token=t` });
    await expect(getSecureUrl(url)).resolves.toEqual({ url: `${url}?token=t` });
    expect(cloudRun).toHaveBeenCalledWith("fileupload", { url });
  });
});
