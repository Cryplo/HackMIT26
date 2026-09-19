import { useState } from "react";
import { createRoot } from "react-dom/client";
function Form() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="controlled">Controlled field</label>
      <input
        id="controlled"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <output id="mirror">{value}</output>
    </>
  );
}
const root = document.createElement("div");
document.querySelector("main")!.prepend(root);
createRoot(root).render(<Form />);
