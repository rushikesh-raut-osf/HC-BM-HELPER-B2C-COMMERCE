import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AnalyzerApp from "./AnalyzerApp";

export default function Page() {
  const hasGate = cookies().get("osf_gate_ok")?.value === "true";
  if (!hasGate) {
    redirect("/gate");
  }
  return <AnalyzerApp />;
}
