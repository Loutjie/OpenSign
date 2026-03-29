import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";
import { getAppLogo } from "../constant/Utils";
import { appInfo } from "../constant/appinfo";

function AutoLogin() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("Authenticating...");

  useEffect(() => {
    const token = searchParams.get("token");
    const userData = searchParams.get("user");
    if (!token) {
      setError("No token provided in URL");
      return;
    }

    (async () => {
      try {
        // 1. Become the user with the session token
        setStatus("Logging in...");
        await Parse.User.become(token);

        // 2. Set localStorage items OpenSign expects
        localStorage.setItem("accesstoken", token);
        localStorage.setItem("appLogo", appInfo.applogo);

        // 3. Set user data from the query params (passed from Cloud Function)
        if (userData) {
          const user = JSON.parse(decodeURIComponent(userData));
          localStorage.setItem("userEmail", user.email || "");
          localStorage.setItem("username", user.name || "");
          localStorage.setItem("_user_role", user.role || "contracts_Admin");
          localStorage.setItem("TenantId", user.tenantId || "");
          localStorage.setItem("TenantName", user.tenantName || "");
          localStorage.setItem("Extand_Class", JSON.stringify([user.extUser || {}]));

          const setting = appInfo.settings.find((s) => s.role === user.role);
          if (setting) {
            localStorage.setItem("PageLanding", setting.pageId);
            localStorage.setItem("defaultmenuid", setting.menuId);
            localStorage.setItem("pageType", setting.pageType);
          }
        }

        // 4. Fetch app logo/tenant info
        await getAppLogo();

        setStatus("Success! Redirecting...");
        window.location.replace("/managesign");
      } catch (err) {
        setError(`AutoLogin failed: ${err.message || JSON.stringify(err)}`);
      }
    })();
  }, []);

  return (
    <div className="flex flex-col justify-center items-center h-[100vh] gap-4 p-8">
      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-lg text-center">
          <p className="text-red-800 font-bold mb-2">AutoLogin Error</p>
          <p className="text-red-600 text-sm font-mono break-all">{error}</p>
          <a href="https://leaselynx.co.za" className="mt-4 inline-block text-blue-600 underline">
            Return to LeaseLynx
          </a>
        </div>
      ) : (
        <>
          <Loader />
          <p className="text-slate-600 text-sm">{status}</p>
        </>
      )}
    </div>
  );
}

export default AutoLogin;
