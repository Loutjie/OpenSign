import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";

function AutoLogin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("Authenticating...");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("No token provided in URL");
      return;
    }
    setStatus(`Attempting become() with token: ${token.substring(0, 30)}...`);
    Parse.User.become(token)
      .then((user) => {
        setStatus(`Success! Logged in as ${user.get("email")}. Redirecting...`);
        setTimeout(() => navigate("/managesign", { replace: true }), 1000);
      })
      .catch((err) => {
        setError(`Parse.User.become() failed: ${err.message || JSON.stringify(err)}`);
      });
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
