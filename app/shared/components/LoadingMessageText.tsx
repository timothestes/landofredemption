/** A loading message, with any ~~text~~ in it drawn struck out. */
export function LoadingMessageText({ message }: { message: string }) {
  // split() with a capture group puts each struck run at an odd index.
  return <>{message.split(/~~(.+?)~~/).map((part, i) => (i % 2 ? <s key={i}>{part}</s> : part))}</>;
}
