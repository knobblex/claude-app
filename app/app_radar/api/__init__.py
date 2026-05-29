"""Hot App Radar sub-app backend entry. Shell calls register(router, ctx)."""

from . import radar


def register(router, ctx):
    radar.bind(ctx)
    p = ctx["prefix"]
    router.add("GET",  f"{p}/apps",                     radar.list_apps_handler)
    router.add("GET",  f"{p}/apps/<slug>",              radar.get_app_handler)
    router.add("GET",  f"{p}/favorites",                radar.list_favorites_handler)
    router.add("POST", f"{p}/favorites/<slug>",         radar.toggle_favorite_handler)
    router.add("GET",  f"{p}/chats",                    radar.list_chats_handler)
    router.add("GET",  f"{p}/chat/<slug>",              radar.get_chat_handler)
    router.add("POST", f"{p}/chat/<slug>",              radar.send_chat_handler)
    router.add("POST", f"{p}/conversation/<slug>",      radar.conversation_for_slug_handler)
    router.add("GET",  f"{p}/ideas",                    radar.list_ideas_handler)
    router.add("GET",  f"{p}/notes/<slug>",             radar.get_note_handler)
    router.add("POST", f"{p}/notes/<slug>",             radar.distill_note_handler)
    router.add("POST", f"{p}/note-suggestions/<slug>",  radar.suggest_notes_handler)
