import type { AnalysisResult, Annotation, PageRegion, Region } from "../src/types.js";
import "./style.css";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const endpointInput = $("#endpointInput") as HTMLInputElement;
const imageInput = $("#imageInput") as HTMLInputElement;
const fileLabel = $("#fileLabel");
const questionInput = $("#questionInput") as HTMLInputElement;
const analyzeButton = $("#analyzeButton") as HTMLButtonElement;
const statusText = $("#statusText");
const imageStage = $("#imageStage");
const emptyState = $("#emptyState");
const imageFrame = $("#imageFrame");
const pageImage = $("#pageImage") as HTMLImageElement;
const overlay = $("#overlay") as SVGSVGElement;
const jsonOutput = $("#jsonOutput");
const imageMeta = $("#imageMeta");
const emptyInspector = $("#emptyInspector");
const resultInspector = $("#resultInspector");
const requestId = $("#requestId");
const tutorMessage = $("#tutorMessage");
const metrics = $("#metrics");
const warnings = $("#warnings");
const annotations = $("#annotations");
const regions = $("#regions");

let selectedFile: File | undefined;
let currentResult: AnalysisResult | undefined;

endpointInput.value = localStorage.getItem("coordinateTestApiUrl") ?? "";
endpointInput.addEventListener("change", () => localStorage.setItem("coordinateTestApiUrl", endpointInput.value.trim()));

function setStatus(label: string, state: "ready" | "busy" | "error" = "ready") {
  statusText.textContent = label;
  document.body.dataset.state = state;
}

async function canonicalDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D canvas.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.84);
}

function setFile(file: File) {
  if (!file.type.startsWith("image/")) return;
  selectedFile = file;
  fileLabel.textContent = file.name;
  setStatus("Photo ready");
}

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (file) setFile(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  imageStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    imageStage.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  imageStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    imageStage.classList.remove("dragging");
  });
}
imageStage.addEventListener("drop", (event) => {
  const file = (event as DragEvent).dataTransfer?.files[0];
  if (file) setFile(file);
});

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function setAttributes(element: Element, attributes: Record<string, string>) {
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
}

function points(region: Region): string {
  return region.polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

function bounds(region: Region) {
  const [left, top, right, bottom] = region.bbox;
  return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

function renderOverlay(result: AnalysisResult) {
  overlay.replaceChildren(overlay.querySelector("defs")!);
  const annotated = new Map(result.annotations.map((annotation) => [annotation.regionId, annotation]));

  for (const region of result.regions) {
    const polygon = svgElement("polygon");
    const kind = annotated.has(region.id) ? "selected" : region.kind;
    setAttributes(polygon, { points: points(region), class: `region-shape ${kind}`, "data-region-id": region.id });
    overlay.appendChild(polygon);
  }

  for (const annotation of result.annotations) {
    const region = result.regions.find((candidate) => candidate.id === annotation.regionId);
    if (!region) continue;
    const box = bounds(region);
    if (annotation.type === "circle") {
      const ellipse = svgElement("ellipse");
      setAttributes(ellipse, { cx: String(box.cx), cy: String(box.cy), rx: String(box.width / 2 + 0.012), ry: String(box.height / 2 + 0.018), class: "annotation-circle" });
      overlay.appendChild(ellipse);
    } else if (annotation.type === "underline") {
      const line = svgElement("line");
      setAttributes(line, { x1: String(box.left), y1: String(Math.min(1, box.bottom + 0.012)), x2: String(box.right), y2: String(Math.min(1, box.bottom + 0.012)), class: "annotation-underline" });
      overlay.appendChild(line);
    } else if (annotation.type === "arrow") {
      const line = svgElement("line");
      setAttributes(line, { x1: "0.08", y1: String(Math.max(0.04, box.cy - 0.08)), x2: String(box.left), y2: String(box.cy), class: "annotation-arrow", "marker-end": "url(#arrowHead)" });
      overlay.appendChild(line);
    } else if (annotation.type === "focus") {
      const focus = svgElement("path");
      setAttributes(focus, { d: `M0,0 H1 V1 H0 Z M${points(region)} Z`, class: "annotation-focus", "fill-rule": "evenodd", "clip-rule": "evenodd" });
      overlay.appendChild(focus);
    }
  }
}

function annotationRow(annotation: Annotation, result: AnalysisResult): HTMLElement {
  const row = document.createElement("div");
  row.className = "annotation-row";
  const region = result.regions.find((candidate) => candidate.id === annotation.regionId);
  row.innerHTML = `<div class="annotation-title"><span class="annotation-type">${annotation.type}</span><code>${annotation.regionId}</code>${annotation.verified === false ? '<span class="unverified">not verified</span>' : ""}</div><p>${annotation.reason ?? "Selected by Nova."}</p>`;
  row.addEventListener("mouseenter", () => highlightRegion(region?.id));
  row.addEventListener("mouseleave", () => highlightRegion(undefined));
  return row;
}

function artifactRow(region: PageRegion): HTMLElement {
  const row = document.createElement("button");
  row.className = "region-row";
  row.type = "button";
  row.innerHTML = `<span class="region-kind ${region.kind}">${region.kind}</span><code>${region.id}</code><span class="region-text">${region.latex ?? region.transcription ?? region.source}</span>`;
  row.addEventListener("click", () => highlightRegion(region.id));
  row.addEventListener("mouseenter", () => highlightRegion(region.id));
  row.addEventListener("mouseleave", () => highlightRegion(undefined));
  return row;
}

function highlightRegion(id: string | undefined) {
  for (const element of overlay.querySelectorAll<SVGElement>("[data-region-id]")) element.classList.toggle("hovered", Boolean(id && element.getAttribute("data-region-id") === id));
}

function renderResult(result: AnalysisResult) {
  currentResult = result;
  pageImage.src = result.document.pages[0]?.imageUrl ?? "";
  imageFrame.hidden = false;
  pageImage.hidden = false;
  overlay.hidden = false;
  emptyState.hidden = true;
  imageMeta.textContent = `${result.image.width} × ${result.image.height}px · ${result.regions.length} regions`;
  requestId.textContent = result.requestId.slice(0, 8);
  tutorMessage.textContent = result.document.latex || result.message;
  metrics.innerHTML = `<span><strong>${result.providers.bda.lineCount}</strong> lines</span><span><strong>${result.providers.bda.wordCount}</strong> words</span><span><strong>${result.providers.bda.artifactCount}</strong> artifacts</span><span><strong>${result.providers.nova.artifactCount}</strong> Nova LaTeX</span><span><strong>${result.providers.nova.status}</strong> Nova</span>`;
  warnings.innerHTML = result.warnings.map((warning) => `<div class="warning">${warning}</div>`).join("");
  annotations.replaceChildren(...result.annotations.map((annotation) => annotationRow(annotation, result)));
  regions.replaceChildren(...result.document.regions.map(artifactRow));
  jsonOutput.textContent = JSON.stringify(result.document, null, 2);
  emptyInspector.hidden = true;
  resultInspector.hidden = false;
  renderOverlay(result);
}

analyzeButton.addEventListener("click", async () => {
  const endpoint = endpointInput.value.trim();
  if (!endpoint) return setStatus("Add the API URL", "error");
  if (!selectedFile) return setStatus("Choose an image", "error");
  analyzeButton.disabled = true;
  setStatus("Reading page…", "busy");
  try {
    const imageDataUrl = await canonicalDataUrl(selectedFile);
    setStatus("Calling AWS…", "busy");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrl, question: questionInput.value.trim() }),
    });
    const payload = await response.json() as AnalysisResult & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    renderResult(payload);
    setStatus("Analysis complete");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Request failed", "error");
  } finally {
    analyzeButton.disabled = false;
  }
});

void currentResult;
