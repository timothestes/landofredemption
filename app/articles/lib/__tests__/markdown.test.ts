import { describe, it, expect } from "vitest";
import { youtubeId, embeddedYoutubeId, isAudioUrl, slugify, SLUG_RE, excerptFromMarkdown, opensCardPicker, flattenCardMentions, parseMention, extractCardMentions, extractImageUrls } from "../markdown";

describe("youtubeId", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=30s`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`  https://youtu.be/${ID}  `],
  ])("parses %s", (url) => {
    expect(youtubeId(url)).toBe(ID);
  });
  it.each([
    ["https://vimeo.com/12345"],
    ["https://example.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=short"],
    ["not a url"],
    [""],
  ])("rejects %s", (url) => {
    expect(youtubeId(url)).toBeNull();
  });
});

describe("isAudioUrl", () => {
  it.each(["a.mp3", "https://x.public.blob.vercel-storage.com/posts/1/ep.m4a", "/f.ogg?x=1", "https://h/f.WAV"])(
    "accepts %s",
    (u) => expect(isAudioUrl(u)).toBe(true),
  );
  it.each(["a.png", "https://h/f.mp4", "https://h/mp3", "", "::"])("rejects %s", (u) =>
    expect(isAudioUrl(u)).toBe(false),
  );
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => expect(slugify("Hello, World!")).toBe("hello-world"));
  it("strips diacritics", () => expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu"));
  it("drops apostrophes without splitting", () => expect(slugify("Jayden\u2019s Deck")).toBe("jaydens-deck"));
  it("drops curly double quotes", () => expect(slugify("The \u201cBest\u201d Deck")).toBe("the-best-deck"));
  it("collapses runs and trims", () => expect(slugify("  --a   b--  ")).toBe("a-b"));
  it("caps at 80 chars without a trailing hyphen", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
    expect(SLUG_RE.test(s)).toBe(true);
  });
  it("returns empty for nothing usable", () => expect(slugify("!!!")).toBe(""));
});

describe("excerptFromMarkdown", () => {
  it("strips markdown syntax", () => {
    const md = "# Title\n\nSome **bold** and _it_ with a [link](https://x.y) and ![img](https://i.png).\n\n> quote\n\n- item";
    expect(excerptFromMarkdown(md)).toBe("Title Some bold and it with a link and . quote item");
  });
  it("ignores bare URLs and fenced code", () => {
    expect(excerptFromMarkdown("https://youtu.be/dQw4w9WgXcQ\n\n```js\nx()\n```\n\nHello")).toBe("Hello");
  });
  it("returns short text unchanged", () => expect(excerptFromMarkdown("Short.")).toBe("Short."));
  it("cuts at a word boundary with an ellipsis", () => {
    const out = excerptFromMarkdown("alpha beta gamma delta epsilon zeta", 17);
    expect(out).toBe("alpha beta gamma…");
  });
});

describe("opensCardPicker", () => {
  // The caret sits right after the text the author just typed.
  const at = (text: string, inputType = "insertText") => opensCardPicker(text, text.length, inputType);

  it("fires on a fresh \"[[\"", () => expect(at("Play [[")).toBe(true));
  it("fires at the very start of the box", () => expect(at("[[")).toBe(true));
  it("ignores a single bracket", () => expect(at("Play [")).toBe(false));
  it("ignores a third bracket before", () => expect(at("Play [[[")).toBe(false));
  it("ignores a bracket after the caret", () => expect(opensCardPicker("[[[", 2)).toBe(false));
  it("ignores undo, which leaves the brackets behind", () => expect(at("Play [[", "historyUndo")).toBe(false));
  it("ignores a caret that is not after the brackets", () => expect(opensCardPicker("[[Son of God]]", 14)).toBe(false));
});

describe("flattenCardMentions", () => {
  it("drops the brackets and keeps the name", () => {
    expect(flattenCardMentions("Run [[Son of God]] and [[Mayhem]].")).toBe("Run Son of God and Mayhem.");
  });
  it("tidies whitespace inside the brackets", () => {
    expect(flattenCardMentions("[[  Son  of God ]]")).toBe("Son of God");
  });
  it("leaves text without mentions alone", () => {
    expect(flattenCardMentions("Plain [words] here.")).toBe("Plain [words] here.");
  });
});

describe("parseMention", () => {
  it("reads a plain mention", () => {
    expect(parseMention("Son of God")).toEqual({ target: "Son of God", label: "Son of God" });
  });
  it("splits target from the words on the page", () => {
    expect(parseMention("Jacob (FooF)|Jacob")).toEqual({ target: "Jacob (FooF)", label: "Jacob" });
  });
  it("tidies whitespace on both halves", () => {
    expect(parseMention("  Moses, the Servant | Moses the Servant ")).toEqual({
      target: "Moses, the Servant",
      label: "Moses the Servant",
    });
  });
  it("splits on the FIRST bar only", () => {
    expect(parseMention("A|B|C")).toEqual({ target: "A", label: "B|C" });
  });
  it("falls back to the target when the label is empty", () => {
    expect(parseMention("Son of God|")).toEqual({ target: "Son of God", label: "Son of God" });
  });
});

describe("aliased mentions elsewhere", () => {
  it("extracts the target, which is what has to resolve", () => {
    expect(extractCardMentions("Play [[Jacob (FooF)|Jacob]] early.")).toEqual(["Jacob (FooF)"]);
  });
  it("flattens to the words the author wrote, not the target", () => {
    expect(flattenCardMentions("Play [[Jacob (FooF)|Jacob]] early.")).toBe("Play Jacob early.");
  });
});

describe("extractImageUrls", () => {
  it("returns distinct absolute image urls outside code, ignoring titles", () => {
    const md = [
      "![a](https://x.test/a.png) and ![b](https://x.test/b.png \"reveal\") and ![dup](https://x.test/a.png)",
      "`![code](https://x.test/inline.png)`",
      "```\n![fence](https://x.test/fence.png)\n```",
      "![rel](/local.png) [link](https://x.test/not-an-image.png)",
    ].join("\n");
    expect(extractImageUrls(md)).toEqual(["https://x.test/a.png", "https://x.test/b.png"]);
  });
});

describe("embeddedYoutubeId", () => {
  const ID = "pk4dGdX5fEc";

  it("finds the first paragraph that is only a YouTube link, bare or bracketed", () => {
    expect(embeddedYoutubeId(`Intro text.\n\nhttps://youtu.be/${ID}\n\nMore.`)).toBe(ID);
    expect(embeddedYoutubeId(`Intro.\n\n  [Watch](https://www.youtube.com/watch?v=${ID}&t=0s)  \n`)).toBe(ID);
    expect(embeddedYoutubeId(`<https://www.youtube.com/watch?v=${ID}>`)).toBe(ID);
    expect(embeddedYoutubeId(`https://youtu.be/${ID}\n\nhttps://youtu.be/65hEWhb2S8E`)).toBe(ID);
  });

  it("ignores links the renderer would not embed", () => {
    expect(embeddedYoutubeId(`Check out this [Tutorial](https://www.youtube.com/watch?v=${ID}) first.`)).toBeNull();
    expect(embeddedYoutubeId("```\nhttps://youtu.be/" + ID + "\n```")).toBeNull();
    expect(embeddedYoutubeId("https://example.com/video")).toBeNull();
    expect(embeddedYoutubeId("")).toBeNull();
  });
});
