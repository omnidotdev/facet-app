import { useEffect, useState } from "react";

import { useAuthSession } from "@/lib/auth/useAuthSession";
import { fetchUserInfo } from "@/lib/auth/userInfo";

/**
 * The signed-in account's subject (the userinfo `sub`), passed as `loginHint`
 * on links to the account hub so the hub opens as the same account. Only the
 * subject, never an email or token. Undefined while signed out or until the
 * profile loads, when hub links simply carry no hint
 */
const useHubLoginHint = (): string | undefined => {
  const { signedIn } = useAuthSession();
  const [subject, setSubject] = useState<string>();

  useEffect(() => {
    if (!signedIn) {
      setSubject(undefined);
      return;
    }
    let active = true;
    fetchUserInfo().then((info) => {
      if (active) setSubject(info?.sub);
    });
    return () => {
      active = false;
    };
  }, [signedIn]);

  return signedIn ? subject : undefined;
};

export default useHubLoginHint;
