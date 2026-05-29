"""Ideas (点子库) sub-app backend entry. Shell calls register(router, ctx)."""

from . import core


def register(router, ctx):
    core.bind(ctx)
    p = ctx["prefix"]
    # ideas
    router.add("GET",    f"{p}/ideas",                                       core.list_ideas)
    router.add("POST",   f"{p}/ideas",                                       core.create_idea)
    router.add("GET",    f"{p}/ideas/<iid>",                                 core.get_idea)
    router.add("POST",   f"{p}/ideas/<iid>/update",                          core.update_idea)
    router.add("DELETE", f"{p}/ideas/<iid>",                                 core.delete_idea)
    # doc history
    router.add("GET",    f"{p}/ideas/<iid>/history",                         core.list_history)
    router.add("GET",    f"{p}/ideas/<iid>/history/<ts>",                    core.get_history)
    router.add("POST",   f"{p}/ideas/<iid>/history/<ts>/restore",            core.restore_history)
    # conversations —— 聊天本身走壳子的 /api/conversations/<cid>/stream，
    # 这里只保留 sub-app 自己的：列举、创建（绑 context）、删除、distill。
    router.add("GET",    f"{p}/ideas/<iid>/conversations",                   core.list_conversations)
    router.add("POST",   f"{p}/ideas/<iid>/conversations",                   core.create_conversation)
    router.add("DELETE", f"{p}/ideas/<iid>/conversations/<cid>",             core.delete_conversation)
    # distill
    router.add("POST",   f"{p}/ideas/<iid>/conversations/<cid>/distill",     core.distill_conversation)
    # files (素材夹) — 任意嵌套，<path:rel> 匹配剩余路径（含 /）
    router.add("GET",    f"{p}/ideas/<iid>/files",                           core.list_files_root)
    router.add("GET",    f"{p}/ideas/<iid>/files/<path:rel>",                core.read_path)
    router.add("POST",   f"{p}/ideas/<iid>/files/<path:rel>",                core.write_file)
    router.add("DELETE", f"{p}/ideas/<iid>/files/<path:rel>",                core.delete_path)
