import { useState } from "react";
import { Copy } from "lucide-react";
import { api, errorMessage, RequestError } from "./api";

export function CarmenReport({
  available,
  busy,
}: {
  available: boolean;
  busy: boolean;
}) {
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState("");

  async function copy() {
    setCopying(true);
    setMessage("");
    setManualCopy("");
    const text = api<object | null>("carmen/compatibility").then((report) => {
      if (!report) throw new RequestError("compatibilityUnavailable");
      return JSON.stringify(report, null, 2);
    });
    async function write() {
      if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
        // Start the clipboard write in the click gesture, including in Safari.
        const blob = text.then(
          (value) => new Blob([value], { type: "text/plain" }),
        );
        void blob.catch(() => {});
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": blob }),
        ]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(await text);
      } else throw new Error("clipboardUnavailable");
    }
    const [report, copied] = await Promise.allSettled([text, write()]);
    setCopying(false);
    if (report.status === "rejected") {
      setMessage(errorMessage(report.reason));
    } else if (copied.status === "fulfilled") {
      setMessage("Report copied.");
    } else {
      setManualCopy(report.value);
      setMessage("Select the report below to copy it.");
    }
  }

  return (
    <div className="portal-body carmen-report">
      <button
        className="secondary full"
        disabled={!available || busy || copying}
        onClick={() => void copy()}
      >
        <Copy size={17} />
        {copying ? "Copying report…" : "Copy compatibility report"}
      </button>
      <small className="muted">
        {available
          ? "Field types and errors only. Cookies and grades stay private."
          : "Available after Carmen responds to sign-in or a sync."}
      </small>
      {available && message && <small role="status">{message}</small>}
      {available && manualCopy && (
        <textarea
          aria-label="Carmen compatibility report"
          readOnly
          rows={5}
          value={manualCopy}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
