import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AssetCache } from "./assets.js";
import { CDN_ASSETS, KATEX_CSS_URL } from "./config.js";
import type { ReadmeReader } from "./readers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const EXPORT_TEMPLATE = `\
<!DOCTYPE html>
<html lang="en" data-color-mode="{data_color_mode}" data-theme="{data_color_mode}" data-light-theme="light" data-dark-theme="dark">
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
{head_assets}
  <style>
    .preview-page { margin-top: 64px; margin-bottom: 21px; }
    .timeline-comment-wrapper > .timeline-comment:after,
    .timeline-comment-wrapper > .timeline-comment:before { content: none; }
    .discussion-timeline.wide { width: 920px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="preview-page">
      <main id="js-repo-pjax-container">
        <div class="clearfix new-discussion-timeline container-xl px-3 px-md-4 px-lg-5">
          <div class="repository-content">
            <div class="clearfix">
              <div class="Layout Layout--flowRow-until-md Layout--sidebarPosition-end Layout--sidebarPosition-flowRow-end">
                <div class="Layout-main">
{page_body}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
  <script id="markdraft-source" type="text/markdown">{escaped_markdown}</script>
{script_assets}
  <script>
{client_js}
  </script>
</body>
</html>`;

const README_BODY = `\
                  <div id="readme" class="Box md Box--responsive">
                    {box_header}
                    <div class="Box-body px-5 pb-5">
                      <article id="markdraft-content" class="markdown-body entry-content container-lg">
                      </article>
                    </div>
                  </div>`;

const USER_CONTENT_BODY = `\
                  <div class="pull-discussion-timeline">
                    <div class="ml-0 pl-0 ml-md-6 pl-md-3">
                      <div class="TimelineItem pt-0">
                        <div class="timeline-comment-group TimelineItem-body my-0">
                          <div class="ml-n3 timeline-comment unminimized-comment comment">
                            {comment_header}
                            <div class="edit-comment-hide">
                              <table class="d-block">
                                <tbody class="d-block">
                                  <tr class="d-block">
                                    <td class="d-block comment-body markdown-body" id="markdraft-content">
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>`;

function readClientJs(): string {
  // Check built location first (dist/static/)
  const builtPath = path.join(__dirname, "static", "markdraft.js");
  if (fs.existsSync(builtPath)) {
    return fs.readFileSync(builtPath, "utf-8");
  }
  // Fallback: dev location (project root static/)
  const devPath = path.resolve(__dirname, "..", "static", "markdraft.js");
  if (fs.existsSync(devPath)) {
    return fs.readFileSync(devPath, "utf-8");
  }
  throw new Error("Cannot find markdraft.js");
}

export function exportPage(
  reader: ReadmeReader,
  subpath: string | null,
  assets: AssetCache,
  options: {
    outFile?: string | null;
    inline?: boolean;
    title?: string | null;
    theme?: string;
    userContent?: boolean;
    wide?: boolean;
    quiet?: boolean;
  } = {},
): string {
  const {
    outFile = null,
    inline = true,
    title = null,
    theme = "light",
    userContent = false,
  } = options;

  const raw = reader.read(subpath);
  const text = typeof raw === "string" ? raw : raw.toString("utf-8");
  const filename = reader.filenameFor(subpath) ?? "";

  const pageTitle = title ?? (filename ? filename + " - Markdraft" : "Markdraft");
  const displayTitle = escapeHtml(title ?? filename);
  const dataColorMode = theme === "dark" ? "dark" : "light";

  // Page body
  let pageBody: string;
  if (userContent) {
    let commentHeader = "";
    if (displayTitle) {
      commentHeader =
        '<div class="timeline-comment-header clearfix d-block d-sm-flex">' +
        '<h3 class="timeline-comment-header-text f5 text-normal">' +
        '<strong class="css-truncate expandable">' +
        '<span class="author text-inherit css-truncate-target">' +
        displayTitle +
        "</span></strong></h3></div>";
    }
    pageBody = USER_CONTENT_BODY.replace("{comment_header}", commentHeader);
  } else {
    let boxHeader = "";
    if (displayTitle) {
      boxHeader =
        '<div class="Box-header d-flex border-bottom-0 flex-items-center' +
        ' flex-justify-between color-bg-default rounded-top-2">' +
        '<div class="d-flex flex-items-center">' +
        '<h2 class="Box-title">' +
        displayTitle +
        "</h2></div></div>";
    }
    pageBody = README_BODY.replace("{box_header}", boxHeader);
  }

  // Escape markdown for embedding in <script> tag
  const escapedMarkdown = text.replace(/<\/script/gi, "<\\/script");

  const highlightCssName =
    theme === "dark" ? "github-highlight-dark.min.css" : "github-highlight.min.css";
  const markdownCssName =
    theme === "dark" ? "github-markdown-dark.css" : "github-markdown-light.css";

  let headAssets: string;
  let scriptAssets: string;

  if (inline) {
    const cssFiles = [markdownCssName, highlightCssName, "leaflet.css"];
    const jsFiles = [
      "marked.min.js",
      "marked-alert.umd.js",
      "highlight.min.js",
      "katex.min.js",
      "marked-katex-extension.umd.js",
      "mermaid.min.js",
      "leaflet.js",
      "three.min.js",
      "marked-emoji.umd.js",
    ];

    const headParts: string[] = [];
    for (const cssName of cssFiles) {
      const cssPath = assets.getPath(cssName);
      if (fs.existsSync(cssPath)) {
        const content = fs.readFileSync(cssPath, "utf-8");
        headParts.push("  <style>\n" + content + "\n  </style>");
      }
    }
    headParts.push(`  <link rel="stylesheet" href="${KATEX_CSS_URL}" />`);
    headAssets = headParts.join("\n");

    const scriptParts: string[] = [];
    for (const jsName of jsFiles) {
      const jsPath = assets.getPath(jsName);
      if (fs.existsSync(jsPath)) {
        const content = fs.readFileSync(jsPath, "utf-8");
        scriptParts.push("  <script>\n" + content + "\n  </script>");
      }
    }
    const gemojiPath = assets.getPath("gemoji.json");
    if (fs.existsSync(gemojiPath)) {
      const content = fs.readFileSync(gemojiPath, "utf-8");
      scriptParts.push(
        '  <script id="markdraft-gemoji" type="application/json">\n' + content + "\n  </script>",
      );
    }
    scriptAssets = scriptParts.join("\n");
  } else {
    const cdn = CDN_ASSETS;
    headAssets = [cdn[markdownCssName], cdn[highlightCssName], KATEX_CSS_URL, cdn["leaflet.css"]]
      .map((url) => `  <link rel="stylesheet" href="${url}" />`)
      .join("\n");

    scriptAssets = [
      "marked.min.js",
      "marked-alert.umd.js",
      "highlight.min.js",
      "katex.min.js",
      "marked-katex-extension.umd.js",
      "mermaid.min.js",
      "leaflet.js",
      "three.min.js",
      "marked-emoji.umd.js",
    ]
      .map((name) => `  <script src="${cdn[name]}"></script>`)
      .join("\n");
  }

  const clientJs = readClientJs();

  let page = EXPORT_TEMPLATE;
  const vars: Record<string, string> = {
    title: escapeHtml(pageTitle),
    data_color_mode: dataColorMode,
    head_assets: headAssets,
    page_body: pageBody,
    escaped_markdown: escapedMarkdown,
    script_assets: scriptAssets,
    client_js: clientJs,
  };
  for (const [key, value] of Object.entries(vars)) {
    page = page.replaceAll(`{${key}}`, value);
  }

  if (outFile === "-") {
    process.stdout.write(page + "\n");
  } else if (outFile != null) {
    fs.writeFileSync(outFile, page, "utf-8");
  }

  return page;
}
