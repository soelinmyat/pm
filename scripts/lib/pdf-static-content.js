"use strict";

const ACTIVE_NAMES = new Set([
  "JavaScript",
  "Encrypt",
  "ObjStm",
  "XRef",
  "JS",
  "OpenAction",
  "AA",
  "Launch",
  "RichMedia",
  "XFA",
  "AcroForm",
  "SubmitForm",
  "ImportData",
  "EmbeddedFile",
  "EmbeddedFiles",
]);

const PDF_WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const isPdfWhitespace = (char) => PDF_WHITESPACE.has(char?.charCodeAt(0));

// Inspect object syntax, not image/font streams or literal/hex text strings.
function assertStaticPdfObjects(objects) {
  for (const source of objects) {
    let cursor = 0;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === "%") {
        const end = /[\r\n]/.exec(source.slice(cursor));
        if (!end) break;
        cursor += end.index;
      } else if (char === "(") {
        let depth = 1;
        cursor += 1;
        while (cursor < source.length && depth) {
          if (source[cursor] === "\\") {
            cursor += 2;
            continue;
          }
          if (source[cursor] === "(") depth += 1;
          if (source[cursor] === ")") depth -= 1;
          cursor += 1;
        }
        if (depth) throw new Error("static PDF has an unterminated literal string");
      } else if (char === "<" && source[cursor + 1] !== "<") {
        cursor = source.indexOf(">", cursor + 1);
        if (cursor < 0) throw new Error("static PDF has an unterminated hex string");
        cursor += 1;
      } else if (char === "/") {
        let end = cursor + 1;
        while (
          end < source.length &&
          !isPdfWhitespace(source[end]) &&
          !"()<>[]{}/%".includes(source[end])
        )
          end += 1;
        if (end === cursor + 1) throw new Error("static PDF has an invalid name");
        const name = source
          .slice(cursor + 1, end)
          .replace(/#([a-f0-9]{2})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)));
        if (ACTIVE_NAMES.has(name))
          throw new Error(`static PDF evidence rejects active content /${name}`);
        cursor = end;
      } else if (
        source.startsWith("stream", cursor) &&
        (isPdfWhitespace(source[cursor - 1]) || source[cursor - 1] === ">") &&
        /[\r\n]/.test(source[cursor + 6] || "")
      ) {
        break;
      } else {
        cursor += char === "<" && source[cursor + 1] === "<" ? 2 : 1;
      }
    }
  }
}

module.exports = { assertStaticPdfObjects };
