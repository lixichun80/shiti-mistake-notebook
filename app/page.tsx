import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <Dashboard name={user?.fullName || "同学"} signedIn={Boolean(user)} signInPath={chatGPTSignInPath("/")} />;
}
