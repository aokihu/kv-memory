import { describe, test, beforeAll, afterAll, expect } from 'bun:test'
import {server} from '../src'

describe("记忆系统测试用例", () => {

    const BASE_MEMORY_KEY = "test_key";
    const RENAME_OLD_KEY = "rename_old_key";
    const RENAME_NEW_KEY = "rename_new_key";
    const RENAME_EXISTING_KEY = "rename_existing_key";
    const RENAME_CONFLICT_SOURCE_KEY = "rename_conflict_source_key";
    let sessionId: string;

    afterAll(async () => {
        await Bun.file("kv.db").exists() && await Bun.file("kv.db").delete()
    })

    test("获取Session", async () => {

        const res = await fetch(`${server.url}/login`, {
            method: "POST",
            body: JSON.stringify({
                namespace:'test'
            })
        })

        expect(res.status).toBe(200);
        
        const payload = await res.json()

        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
        expect(payload).toHaveProperty("data");

        sessionId = payload.data;
        console.log('Get session:', sessionId)
    })

    test("添加记忆", async () => {

        const res = await fetch(`${server.url}/add_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: BASE_MEMORY_KEY,
                value: {
                    summary: "test_summary",
                    text: "test_value",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        if (payload.success === false) {
            console.log(payload.message)
        }
        expect(payload.success).toBe(true);
    })


    test("读取记忆", async () => {
        const res = await fetch(`${server.url}/get_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: BASE_MEMORY_KEY,
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()

        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
        expect(payload).toHaveProperty("data");

        expect(payload.data).toHaveProperty("summary");
        expect(payload.data.summary).toBe("test_summary");
        expect(payload.data).toHaveProperty("text");
        expect(payload.data.text).toBe("test_value");
    })


    test("更新记忆内容", async () => {
        const res = await fetch(`${server.url}/update_memory`, {    
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: BASE_MEMORY_KEY,
                value: {
                    summary: "updated_summary",
                    text: "updated_text",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        console.log(payload)
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
        expect(payload).toHaveProperty("data");
        expect(payload.data.key).toBe(BASE_MEMORY_KEY);

        const getRes = await fetch(`${server.url}/get_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: BASE_MEMORY_KEY,
            }),
        })

        expect(getRes.status).toBe(200);
        const getPayload = await getRes.json()
        expect(getPayload).toHaveProperty("success");
        expect(getPayload.success).toBe(true);
        expect(getPayload).toHaveProperty("data");
        expect(getPayload.data.summary).toBe("updated_summary");
        expect(getPayload.data.text).toBe("updated_text");
    })


    test("部分更新记忆内容", async () => {
        const res = await fetch(`${server.url}/update_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: BASE_MEMORY_KEY,
                value: {
                    summary: "partial_summary",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);

        const getRes = await fetch(`${server.url}/get_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: BASE_MEMORY_KEY,
            }),
        })

        expect(getRes.status).toBe(200);
        const getPayload = await getRes.json()
        expect(getPayload).toHaveProperty("success");
        expect(getPayload.success).toBe(true);
        expect(getPayload).toHaveProperty("data");
        expect(getPayload.data.summary).toBe("partial_summary");
        expect(getPayload.data.text).toBe("updated_text");
    })


    test("更新记忆内容 - 无效Session", async () => {
        const res = await fetch(`${server.url}/update_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: "invalid_session",
                key: BASE_MEMORY_KEY,
                value: {
                    summary: "should_fail",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(false);
        expect(payload.message).toBe("invalid session");
    })


    test("更新记忆内容 - 记忆不存在", async () => {
        const res = await fetch(`${server.url}/update_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: "missing_key",
                value: {
                    summary: "should_fail",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(false);
        expect(payload.message).toBe("memory not found");
    })


    test("添加记忆(用于重命名)", async () => {
        const res = await fetch(`${server.url}/add_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: RENAME_OLD_KEY,
                value: {
                    summary: "rename_summary",
                    text: "rename_text",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
    })


    test("添加记忆(用于重名冲突)", async () => {
        const res = await fetch(`${server.url}/add_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: RENAME_EXISTING_KEY,
                value: {
                    summary: "rename_conflict_summary",
                    text: "rename_conflict_text",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
    })


    test("添加记忆(用于重命名冲突源)", async () => {
        const res = await fetch(`${server.url}/add_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: RENAME_CONFLICT_SOURCE_KEY,
                value: {
                    summary: "rename_conflict_source_summary",
                    text: "rename_conflict_source_text",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
    })


    test("重命名记忆键", async () => {
        const res = await fetch(`${server.url}/update_memory_key`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                old_key: RENAME_OLD_KEY,
                new_key: RENAME_NEW_KEY,
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
        expect(payload.data.old_key).toBe(RENAME_OLD_KEY);
        expect(payload.data.new_key).toBe(RENAME_NEW_KEY);

        const getRes = await fetch(`${server.url}/get_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: RENAME_NEW_KEY,
            }),
        })

        expect(getRes.status).toBe(200);
        const getPayload = await getRes.json()
        expect(getPayload).toHaveProperty("success");
        expect(getPayload.success).toBe(true);
        expect(getPayload.data.summary).toBe("rename_summary");
        expect(getPayload.data.text).toBe("rename_text");
    })


    test("重命名记忆键 - 无效Session", async () => {
        const res = await fetch(`${server.url}/update_memory_key`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: "invalid_session",
                old_key: RENAME_CONFLICT_SOURCE_KEY,
                new_key: "rename_invalid_session",
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(false);
        expect(payload.message).toBe("invalid session");
    })


    test("重命名记忆键 - 旧键不存在", async () => {
        const res = await fetch(`${server.url}/update_memory_key`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                old_key: "missing_old_key",
                new_key: "rename_new_key_missing_old",
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(false);
        expect(payload.message).toBe("memory not found");
    })


    test("重命名记忆键 - 新键已存在", async () => {
        const res = await fetch(`${server.url}/update_memory_key`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                old_key: RENAME_CONFLICT_SOURCE_KEY,
                new_key: RENAME_EXISTING_KEY,
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(false);
        expect(payload.message).toBe("key already exists");
    })


    test("重命名记忆键 - 新旧键相同", async () => {
        const res = await fetch(`${server.url}/update_memory_key`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                old_key: "same_key",
                new_key: "same_key",
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(false);
        expect(payload.message).toBe("old_key and new_key must be different");
    })

})
