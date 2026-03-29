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
      console.error("AutoLogin: No token in URL");
      window.location.replace("https://leaselynx.co.za");
      return;
    }
    console.log("AutoLogin: Attempting to become user with token:", token.substring(0, 20) + "...");
    Parse.User.become(token)
      .then((user) => {
        console.log("AutoLogin: Success, user is", user.get("email"));
        navigate("/managesign", { replace: true });
      })
      .catch((err) => {
        console.error("AutoLogin: Parse.User.become() failed:", err);
        window.location.replace("https://leaselynx.co.za");
      });
  }, []);

  return (
    <div className="flex justify-center items-center h-[100vh]">
      <Loader />
    </div>
  );
}

export default AutoLogin;
