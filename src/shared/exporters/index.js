import * as curl from "./curl.js";
import * as python from "./python.js";
import * as jmx from "./jmx.js";
import * as postman from "./postman.js";
import * as har from "./har.js";

export const exporters = {
  curl: { label: "curl", extension: "sh", generate: curl.generate },
  python: { label: "Python requests", extension: "py", generate: python.generate },
  jmx: { label: "JMeter (.jmx)", extension: "jmx", generate: jmx.generate },
  postman: { label: "Postman Collection", extension: "json", generate: postman.generate },
  har: { label: "HAR", extension: "har", generate: har.generate },
};

export function exporterOptions() {
  return Object.entries(exporters).map(([id, exporter]) => ({ id, ...exporter }));
}
