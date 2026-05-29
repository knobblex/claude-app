export function EmptyState() {
  return (
    <div className="h-full grid place-items-center px-8 bg-notion-bg">
      <div className="text-center max-w-[460px]">
        <div className="w-14 h-14 mx-auto mb-6 rounded-xl bg-white border border-notion-border grid place-items-center text-[24px] shadow-[0_1px_2px_rgba(15,15,15,0.04)]">
          📡
        </div>
        <p className="font-serif text-[26px] text-notion-text mb-3 tracking-tight">从左侧选一个 App</p>
        <p className="text-[15px] text-notion-text2 leading-relaxed mb-6">
          看完整卷宗 · 写笔记打标签 · 跟 Claude 聊每个机制能套到哪些场景
        </p>
        <div className="flex items-center justify-center gap-4 text-[13px] text-notion-text3">
          <span className="flex items-center gap-1.5">
            <kbd className="notion-kbd">↑</kbd>
            <kbd className="notion-kbd">↓</kbd> 导航
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="notion-kbd">↵</kbd> 打开
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="notion-kbd">⌘</kbd>
            <kbd className="notion-kbd">K</kbd> 搜索
          </span>
        </div>
      </div>
    </div>
  );
}
