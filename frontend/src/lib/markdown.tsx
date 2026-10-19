import type { Components } from 'react-markdown'

export const markdownComponents: Components = {
  table: ({ node, ...props }) => (
    <div className="max-w-full overflow-x-auto lg:contents">
      <table {...props} />
    </div>
  ),
}
