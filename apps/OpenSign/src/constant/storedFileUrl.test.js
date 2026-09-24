import { describe, it, expect } from "vitest";
import { isLocalParseFileUrl } from "./storedFileUrl";

const SERVER = "https://signing-api.leaselynx.co.za/app/";
const KEY = "c1a827bec10ab7baf3a156849d6487da_Lease_Tenant.pdf";

describe("isLocalParseFileUrl (client)", () => {
  it("is true only for Parse file URLs under the server mount", () => {
    expect(isLocalParseFileUrl(`https://signing-api.leaselynx.co.za/app/files/opensign/${KEY}`, SERVER)).toBe(true);
    expect(isLocalParseFileUrl(`https://storage.googleapis.com/leaselynx-opensign-files/${KEY}`, SERVER)).toBe(false);
    expect(isLocalParseFileUrl(`https://storage.googleapis.com/leaselynx-opensign-files/${KEY}?X-Amz-Signature=x`, SERVER)).toBe(false);
    expect(isLocalParseFileUrl("nonsense", SERVER)).toBe(false);
  });

  // Same rule as the server copy (spec/storedFileUrl.spec.js), case-sensitivity included.
  it("matches host and mount exactly, not by substring or case", () => {
    const local = `https://signing-api.leaselynx.co.za/app/files/opensign/${KEY}`;
    expect(isLocalParseFileUrl(local, "https://signing-api.leaselynx.co.za/app")).toBe(true);
    expect(isLocalParseFileUrl(`https://signing-api.leaselynx.co.za/app/Files/opensign/${KEY}`, SERVER)).toBe(false);
    expect(isLocalParseFileUrl(`https://signing-api.leaselynx.co.za/files/opensign/${KEY}`, SERVER)).toBe(false);
    expect(isLocalParseFileUrl(`https://evil.example/app/files/opensign/${KEY}`, SERVER)).toBe(false);
    expect(isLocalParseFileUrl(`https://storage.googleapis.com/leaselynx-opensign-files/files/${KEY}`, SERVER)).toBe(false);
    expect(isLocalParseFileUrl(local, null)).toBe(false);
  });
});
