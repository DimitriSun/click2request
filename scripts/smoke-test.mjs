import { generate } from "../src/shared/exporters/curl.js";
import { generate as genPython } from "../src/shared/exporters/python.js";
import { generate as genJmx } from "../src/shared/exporters/jmx.js";
import { generate as genPostman } from "../src/shared/exporters/postman.js";
import { generate as genHar } from "../src/shared/exporters/har.js";
import { replaceTokens } from "../src/shared/variables.js";

const record = {
  id: "s1_r1",
  sessionId: "s1",
  method: "POST",
  url: "http://192.168.1.5:8080/api/users?page=1",
  host: "192.168.1.5",
  path: "/api/users",
  query: [{ name: "page", value: "1" }],
  protocol: "http",
  port: "8080",
  statusCode: 200,
  statusText: "OK",
  mimeType: "application/json",
  requestHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Authorization", value: "Bearer {{token}}" },
    { name: "Cookie", value: "sid=abc123" },
  ],
  requestBody: { type: "json", content: '{"name":"{{userName}}","age":18}', truncated: false },
  responseHeaders: [{ name: "Content-Type", value: "application/json" }],
  responseBody: { type: "json", content: '{"id":1,"name":"test"}', truncated: false },
  ttfbMs: 12,
  downloadMs: 34,
  totalMs: 46,
  sizeBytes: 21,
  wallTime: Date.now(),
  timestamp: 1.5,
  seq: 1,
  resourceType: "fetch",
  initiatorType: "fetch",
  pageUrl: "http://192.168.1.5:8080/",
  errorText: null,
};

const variables = {
  vars: { userName: "张三", token: "TOKEN123" },
  environments: [],
  activeEnvId: null,
};

globalThis.chrome = { runtime: { getManifest: () => ({ version: "0.0.0" }) } };

const options = { variables, maskSensitive: false, sessionName: "Smoke Test" };

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};

const curlOut = generate([record], options);
check("curl 含变量替换", curlOut.includes("http://192.168.1.5:8080/api/users?page=1") && curlOut.includes("TOKEN123") && curlOut.includes("张三"));

const pyOut = genPython([record], options);
check("python 可执行", !pyOut.includes("undefined") && pyOut.includes("assert response.status_code == 200"));

const jmxOut = genJmx([record], options);
check("jmx 结构", jmxOut.startsWith('<?xml') && jmxOut.includes("HTTPSamplerProxy") && jmxOut.includes("192.168.1.5") && jmxOut.includes("{{userName}}"));
check("jmx 变量声明", jmxOut.includes("Argument.name\">userName</stringProp>"));

let postmanOk = false;
try {
  const parsed = JSON.parse(genPostman([record], options));
  postmanOk = parsed.info.schema.includes("collection") && parsed.item.length === 1 && parsed.item[0].request.url.host[0] === "192.168.1.5";
} catch {}
check("postman JSON 有效", postmanOk);

let harOk = false;
try {
  const parsed = JSON.parse(genHar([record]));
  harOk = parsed.log.version === "1.2" && parsed.log.entries.length === 1 && parsed.log.entries[0].request.method === "POST";
} catch {}
check("har JSON 有效", harOk);

const masked = genPython([record], { ...options, maskSensitive: true });
check("脱敏生效", !masked.includes("sid=abc123") && !masked.includes("TOKEN123"));

check("replaceTokens", replaceTokens("{{token}}-{{missing}}", variables) === "TOKEN123-{{missing}}");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
