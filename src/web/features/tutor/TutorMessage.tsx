import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import type { ChatState } from '../../../shared/tutor-chat';

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; url?: string };

/** Link bare evidence IDs without rewriting Markdown links or code examples. */
function evidenceLinks(evidence: NonNullable<ChatState['evidence']>) {
  const records = new Map(evidence.map((record) => [record.id.toLowerCase(), record]));
  return () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (['link', 'linkReference', 'code', 'inlineCode'].includes(node.type)) return;
      if (!node.children) return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== 'text') {
          walk(child);
          return [child];
        }
        return (child.value ?? '')
          .split(/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/gi)
          .filter(Boolean)
          .map((value) => {
            const record = records.get(value.toLowerCase());
            return record
              ? {
                  type: 'link',
                  url: `/attempts/${record.id}`,
                  children: [{ type: 'text', value: record.title }],
                }
              : { type: 'text', value };
          });
      });
    };
    walk(tree);
  };
}

export function TutorMessage({
  text,
  evidence = [],
}: {
  text: string;
  evidence?: ChatState['evidence'];
}) {
  return (
    <div className="min-w-0 break-words leading-relaxed [&>*+*]:mt-3 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1 [&_li>p]:my-1 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_th]:border [&_th]:p-2 [&_td]:border [&_td]:p-2">
      <Markdown
        remarkPlugins={[remarkGfm, evidenceLinks(evidence)]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const id = /^(?:#attempt\/|\/attempts\/)([a-f0-9-]+)$/i.exec(href ?? '')?.[1];
            const record = evidence.find((item) => item.id.toLowerCase() === id?.toLowerCase());
            if (record)
              return (
                <Link to={`/attempts/${record.id}`} className="underline underline-offset-2">
                  {children}
                </Link>
              );
            if (/^https?:\/\//i.test(href ?? ''))
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {children}
                </a>
              );
            return <>{children}</>;
          },
          // Model-generated image URLs must not trigger remote image requests.
          img: ({ alt }) => <span>{alt}</span>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
