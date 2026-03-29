import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";

function AutoLogin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      window.location.replace("https://leaselynx.co.za");
      return;
    }
    Parse.User.become(token)
      .then(() => navigate("/managesign", { replace: true }))
      .catch(() => window.location.replace("https://leaselynx.co.za"));
  }, []);

  return (
    <div className="flex justify-center items-center h-[100vh]">
      <Loader />
    </div>
  );
}

export default AutoLogin;
