declare module "@uiw/react-md-editor" {
  import * as React from "react";

  export type MDEditorProps = {
    value?: string;
    onChange?: (value?: string) => void;
    preview?: "live" | "edit" | "preview";
    height?: number;
    visibleDragbar?: boolean;
    [key: string]: unknown;
  };

  type MarkdownProps = {
    source?: string;
    [key: string]: unknown;
  };

  const MDEditor: React.FC<MDEditorProps> & {
    Markdown: React.FC<MarkdownProps>;
  };

  export default MDEditor;
}
