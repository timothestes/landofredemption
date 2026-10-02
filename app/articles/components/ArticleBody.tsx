import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import { deckIdFromUrl, isAudioUrl, mentionKey, youtubeId } from "../lib/markdown";
import remarkCardMentions from "../lib/remarkCardMentions";
import { EMPTY_REFS, type ArticleRefs } from "../lib/refTypes";
import CardMention from "./CardMention";
import GlossaryMention from "./GlossaryMention";
import DeckEmbed from "./DeckEmbed";
import RevealImage from "./RevealImage";

// The ONE markdown renderer: public article page (server) and editor preview
// (client) both use it, so what the poster previews is what readers get.
// No rehype-raw: raw HTML in the markdown is escaped, which is the whole XSS
// story. react-markdown's default urlTransform already drops javascript: URLs.
//
// Card mentions (`[[Name]]`) and deck embeds (a deck URL alone on a paragraph)
// need the card index and Supabase, which must stay off the client — so the
// caller resolves them (app/articles/lib/refs.ts) and hands the result in as
// `refs`. Without refs, mentions are plain text and deck URLs are links.

/** href of the paragraph's only child when that child is a link, else null. */
function soleLinkHref(node: Element | undefined): string | null {
  if (!node) return null;
  const kids = node.children.filter((c) => !(c.type === "text" && c.value.trim() === ""));
  if (kids.length !== 1) return null;
  const only = kids[0];
  if (only.type !== "element" || only.tagName !== "a") return null;
  const href = only.properties?.href;
  return typeof href === "string" ? href : null;
}

export function YouTubeEmbed({ id }: { id: string }) {
  return (
    <div
      className="article-embed relative my-6 w-full overflow-hidden rounded-lg bg-muted"
      style={{ aspectRatio: "16 / 9" }}
    >
      <iframe
        className="absolute inset-0 h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title="YouTube video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}

function buildComponents(refs: ArticleRefs, draft: boolean): Components {
  const components = {
    // A paragraph that is ONLY a YouTube link becomes the embed instead of a
    // <p> — an iframe inside <p> is invalid HTML and warns on hydration. A
    // paragraph that is only a deck link becomes the deck, for the same reason.
    p: ({ node, children, ...props }) => {
      const href = soleLinkHref(node);
      const id = href ? youtubeId(href) : null;
      if (id) return <YouTubeEmbed id={id} />;
      const deckId = href ? deckIdFromUrl(href) : null;
      // Absent from refs (nothing resolved, or the loader failed) keeps the link.
      if (deckId && deckId in refs.decks) return <DeckEmbed id={deckId} deck={refs.decks[deckId]} />;
      return <p {...props}>{children}</p>;
    },
    a: ({ node: _node, href, children, ...props }) => {
      if (href && isAudioUrl(href)) {
        return (
          <span className="article-audio my-4 block">
            <audio controls preload="none" src={href} className="w-full" />
            <a href={href} className="mt-1 inline-block text-xs text-muted-foreground" download>
              {children}
            </a>
          </span>
        );
      }
      const external = !!href && /^https?:\/\//i.test(href);
      return (
        <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...props}>
          {children}
        </a>
      );
    },
    img: ({ node: _node, src, alt, ...props }) => {
      const url = typeof src === "string" ? src : undefined;
      // `![alt](url "reveal")` starts face down behind the card back.
      if (props.title === "reveal") return <RevealImage src={url} alt={alt ?? ""} />;
      return (
        // Plain <img>: dimensions are unknown and hosts vary (Blob today, the old
        // WordPress uploads after the import). next/image needs width/height.
        <img
          src={url}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className="mx-auto max-w-full rounded-md"
          {...props}
        />
      );
    },
    // Produced by remarkCardMentions: `name` is the card the mention points at,
    // `label` the words that stand on the page (they differ for `[[a|b]]`).
    //
    // The card's RESOLVED name goes to CardMention, not the text that was
    // typed: `[[LAFS]]` reaches its card through an alias, and the enlarge
    // modal's caption and the image's alt text are the one place a reader can
    // find out what "LAFS" actually stands for. The page still shows the words
    // the author wrote. Falls back to the typed text when nothing resolved, so
    // the draft editor's "No card named …" still names what was typed.
    "card-mention": ({ name, label }: { name?: string; label?: string }) => {
      const typed = typeof name === "string" ? name : "";
      const ref = refs.cards[mentionKey(typed)];
      const shown = typeof label === "string" ? label : typed;
      // A card first, always. Community shorthand ("EC", "LoC") only gets a
      // look when nothing in the catalog answered to the name.
      if (!ref) {
        const term = refs.terms?.[mentionKey(typed)];
        if (term) return <GlossaryMention text={shown} entry={term} />;
      }
      return <CardMention name={ref?.name ?? typed} label={shown} imgFile={ref?.imgFile} draft={draft} />;
    },
  } satisfies Components & { "card-mention": unknown };
  return components as Components;
}

export default function ArticleBody({
  markdown,
  refs = EMPTY_REFS,
  draft = false,
  className = "article-body prose prose-neutral max-w-none sm:prose-lg",
}: {
  markdown: string;
  /** Resolved card mentions and deck embeds; see app/articles/lib/refs.ts. */
  refs?: ArticleRefs;
  /** Editor preview: mark mentions that resolved to nothing. */
  draft?: boolean;
  /** Wrapper classes. Deck descriptions render the same markdown in a smaller,
      non-article voice; everything else keeps the article typography. */
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCardMentions]} components={buildComponents(refs, draft)}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
