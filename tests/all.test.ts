import { describe, test, beforeAll, afterAll, expect } from 'bun:test'

describe("记忆系统测试用例", () => {

    const API_URL = "http://localhost:3000";
    let sessionId: string;

    afterAll(async () => {
        // await Bun.file("kv.db").exists() && await Bun.file("kv.db").delete()
    })

    test("获取Session", async () => {

        const res = await fetch(`${API_URL}/login`, {
            method: "GET",
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

        const res = await fetch(`${API_URL}/add_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                key: "test_key",
                value: {
                    summary: "test_summary",
                    text: "test_value",
                },
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
    })


    test("读取记忆", async () => {
        const res = await fetch(`${API_URL}/get_memory`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: sessionId,
                key: "test_key",
            }),
        })

        expect(res.status).toBe(200);
        const payload = await res.json()

        console.log(payload)
        expect(payload).toHaveProperty("success");
        expect(payload.success).toBe(true);
        expect(payload).toHaveProperty("data");

        expect(payload.data).toHaveProperty("summary");
        expect(payload.data.summary).toBe("test_summary");
        expect(payload.data).toHaveProperty("text");
        expect(payload.data.text).toBe("test_value");
    })


})