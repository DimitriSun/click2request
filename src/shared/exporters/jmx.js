import { escapeHtml, isSensitiveHeader, parseUrl } from "../utils.js";
import { collectTokens, resolveVariable } from "../variables.js";

export function generate(records, options = {}) {
  const { variables, maskSensitive, sessionName = "Click2Request Session" } = options;
  const tokens = collectTokens(records);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">',
    "  <hashTree>",
    `    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${xml(sessionName)}" enabled="true">`,
    "      <stringProp name=\"TestPlan.comments\"></stringProp>",
    "      <boolProp name=\"TestPlan.functional_mode\">false</boolProp>",
    "      <boolProp name=\"TestPlan.serialize_threadgroups\">false</boolProp>",
    '      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">',
    "        <collectionProp name=\"Arguments.arguments\">",
    ...tokens.map((token) => variableElement(token, resolveVariable(token, variables))),
    "        </collectionProp>",
    "      </elementProp>",
    "      <stringProp name=\"TestPlan.user_define_classpath\"></stringProp>",
    "    </TestPlan>",
    "    <hashTree>",
    '      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">',
    '        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>',
    '        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">',
    "          <boolProp name=\"LoopController.continue_forever\">false</boolProp>",
    '          <stringProp name="LoopController.loops">1</stringProp>',
    "        </elementProp>",
    '        <stringProp name="ThreadGroup.num_threads">1</stringProp>',
    '        <stringProp name="ThreadGroup.ramp_time">1</stringProp>',
    "        <boolProp name=\"ThreadGroup.scheduler\">false</boolProp>",
    '        <stringProp name="ThreadGroup.duration"></stringProp>',
    '        <stringProp name="ThreadGroup.delay"></stringProp>',
    "      </ThreadGroup>",
    "      <hashTree>",
    ...records.map((record) => samplerTree(record, { maskSensitive })),
    "      </hashTree>",
    "    </hashTree>",
    "  </hashTree>",
    "</jmeterTestPlan>",
  ];
  return lines.join("\n");
}

function variableElement(name, value) {
  return [
    `          <elementProp name="${xml(name)}" elementType="Argument">`,
    `            <stringProp name="Argument.name">${xml(name)}</stringProp>`,
    `            <stringProp name="Argument.value">${xml(value ?? "")}</stringProp>`,
    "            <stringProp name=\"Argument.metadata\">=</stringProp>",
    "          </elementProp>",
  ].join("\n");
}

function samplerTree(record, { maskSensitive }) {
  const url = parseUrl(record.url);
  const name = `${record.method} ${url.pathname}`;
  const path = url.pathname + url.search;
  const headers = (record.requestHeaders || []).filter((header) => !(maskSensitive && isSensitiveHeader(header.name)));
  const hasBody = Boolean(record.requestBody?.content) && !["GET", "HEAD"].includes(record.method);
  const lines = [];
  lines.push(`        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${xml(name)}" enabled="true">`);
  lines.push('          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">');
  lines.push("            <collectionProp name=\"Arguments.arguments\">");
  if (hasBody) {
    lines.push('              <elementProp name="" elementType="HTTPArgument">');
    lines.push("                <boolProp name=\"HTTPArgument.always_encode\">false</boolProp>");
    lines.push(`                <stringProp name="Argument.value">${xml(record.requestBody.content)}</stringProp>`);
    lines.push("                <stringProp name=\"Argument.metadata\">=</stringProp>");
    lines.push("                <boolProp name=\"HTTPArgument.use_equals\">false</boolProp>");
    lines.push('                <stringProp name="Argument.name"></stringProp>');
    lines.push("              </elementProp>");
  }
  lines.push("            </collectionProp>");
  lines.push("          </elementProp>");
  lines.push(`          <stringProp name="HTTPSampler.domain">${xml(url.host)}</stringProp>`);
  lines.push(`          <stringProp name="HTTPSampler.port">${xml(url.port || "")}</stringProp>`);
  lines.push(`          <stringProp name="HTTPSampler.protocol">${xml(url.protocol || "http")}</stringProp>`);
  lines.push(`          <stringProp name="HTTPSampler.path">${xml(path)}</stringProp>`);
  lines.push(`          <stringProp name="HTTPSampler.method">${xml(record.method)}</stringProp>`);
  lines.push("          <boolProp name=\"HTTPSampler.follow_redirects\">true</boolProp>");
  lines.push("          <boolProp name=\"HTTPSampler.auto_redirects\">false</boolProp>");
  lines.push("          <boolProp name=\"HTTPSampler.use_keepalive\">true</boolProp>");
  lines.push(`          <boolProp name="HTTPSampler.postBodyRaw">${hasBody ? "true" : "false"}</boolProp>`);
  lines.push("          <stringProp name=\"HTTPSampler.connect_timeout\"></stringProp>");
  lines.push("          <stringProp name=\"HTTPSampler.response_timeout\"></stringProp>");
  lines.push("        </HTTPSamplerProxy>");
  lines.push("        <hashTree>");
  if (headers.length) {
    lines.push('          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">');
    lines.push("            <collectionProp name=\"HeaderManager.headers\">");
    for (const header of headers) {
      lines.push(`              <elementProp name="${xml(header.name)}" elementType="Header">`);
      lines.push(`                <stringProp name="Header.name">${xml(header.name)}</stringProp>`);
      lines.push(`                <stringProp name="Header.value">${xml(header.value)}</stringProp>`);
      lines.push("              </elementProp>");
    }
    lines.push("            </collectionProp>");
    lines.push("          </HeaderManager>");
    lines.push("          <hashTree/>");
  }
  lines.push("        </hashTree>");
  return lines.join("\n");
}

const xml = escapeHtml;
