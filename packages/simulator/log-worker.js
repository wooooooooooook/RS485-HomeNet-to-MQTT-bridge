// CORS 헤더 설정
const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // 모든 출처 허용 (보안 필요시 특정 도메인으로 변경)
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export default {
    async fetch(request, env) {
        // 1. Preflight (OPTIONS) 요청 처리
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: corsHeaders,
            });
        }

        const url = new URL(request.url);
        const requestKey = request.headers.get("x-api-key");
        const PUT_KEY = env.PUT_KEY;
        const ADMIN_KEY = env.ADMIN_KEY;

        try {
            // ==========================================
            // [GET] 로그 조회 (ADMIN_KEY 필요)
            // ==========================================
            if (request.method === "GET") {
                if (requestKey !== ADMIN_KEY) {
                    return new Response("Forbidden: Invalid Admin Key", {
                        status: 403,
                        headers: corsHeaders
                    });
                }

                const id = url.searchParams.get("id");

                // 1. 상세 조회
                if (id) {
                    const log = await env.LOG_DB.prepare(
                        "SELECT * FROM logs WHERE id = ?"
                    ).bind(id).first();

                    if (!log) {
                        return new Response("Log not found", {
                            status: 404,
                            headers: corsHeaders
                        });
                    }
                    return new Response(JSON.stringify(log), {
                        headers: {
                            "Content-Type": "application/json",
                            ...corsHeaders // CORS 헤더 추가
                        }
                    });
                }

                // 2. 목록 조회 (검색 기능 추가)
                const search = url.searchParams.get("search");
                const uid = url.searchParams.get("uid"); // 기존 하위 호환
                const limit = Math.min(parseInt(url.searchParams.get("limit")) || 20, 50);
                const offset = parseInt(url.searchParams.get("offset")) || 0;

                let sql = `
            SELECT 
              id, uid, client_timestamp, server_timestamp, 
              version, architecture, is_supervisor, port_ids 
            FROM logs
          `;
                const params = [];
                const conditions = [];

                if (search) {
                    const searchPattern = `%${search}%`;
                    // id, uid, port_ids 에서 검색
                    conditions.push("(id LIKE ? OR uid LIKE ? OR port_ids LIKE ?)");
                    params.push(searchPattern, searchPattern, searchPattern);
                } else if (uid) {
                    conditions.push("uid = ?");
                    params.push(uid);
                }

                if (conditions.length > 0) {
                    sql += " WHERE " + conditions.join(" AND ");
                }

                sql += " ORDER BY server_timestamp DESC LIMIT ? OFFSET ?";
                params.push(limit, offset);

                const { results } = await env.LOG_DB.prepare(sql).bind(...params).all();

                return new Response(JSON.stringify(results), {
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders // CORS 헤더 추가
                    }
                });
            }

            // ==========================================
            // [POST] 로그 저장 (PUT_KEY 필요)
            // ==========================================
            if (request.method === "POST") {
                if (requestKey !== PUT_KEY) {
                    return new Response("Forbidden: Invalid API Key", {
                        status: 403,
                        headers: corsHeaders
                    });
                }

                const body = await request.json();
                const {
                    uid, timestamp, version, architecture, isRunningOnHASupervisor,
                    configs, logs, packets
                } = body;

                const id = crypto.randomUUID();
                const serverTimestamp = Date.now();

                // Extract port IDs
                const portIds = (configs || [])
                    .map(c => c.portId)
                    .filter(Boolean)
                    .join(',');

                const { success } = await env.LOG_DB.prepare(
                    `INSERT INTO logs (
              id, uid, client_timestamp, server_timestamp, version, architecture, is_supervisor, configs, app_logs, packets, port_ids
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                    .bind(
                        id,
                        uid || null,
                        timestamp || null,
                        serverTimestamp,
                        version || null,
                        architecture || null,
                        isRunningOnHASupervisor ? 1 : 0,
                        JSON.stringify(configs || []),
                        JSON.stringify(logs || []),
                        JSON.stringify(packets || []),
                        portIds || null
                    )
                    .run();

                if (!success) {
                    return new Response("Database Error", {
                        status: 500,
                        headers: corsHeaders
                    });
                }
                return new Response("OK", {
                    headers: corsHeaders
                });
            }

            return new Response("Method Not Allowed", {
                status: 405,
                headers: corsHeaders
            });

        } catch (e) {
            console.error(e);
            return new Response("Internal Server Error: " + e.message, {
                status: 500,
                headers: corsHeaders
            });
        }
    }
};
