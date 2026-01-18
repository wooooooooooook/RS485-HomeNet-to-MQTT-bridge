/**
 * Gallery Snippet Stats Worker
 * Cloudflare Worker + D1 기반 갤러리 스니펫 다운로드 통계 수집
 *
 * API:
 * - GET /  : 모든 스니펫의 다운로드 수 조회 (인증 불필요)
 * - POST / : 다운로드 카운트 증가 (PUT_KEY 인증 필요)
 *
 * D1 테이블 생성:
 * CREATE TABLE IF NOT EXISTS snippet_stats (
 *     id TEXT PRIMARY KEY,
 *     downloads INTEGER DEFAULT 0,
 *     last_downloaded_at INTEGER
 * );
 *
 * 환경변수 (wrangler.toml 또는 Cloudflare 대시보드에서 설정):
 * - PUT_KEY: 쓰기 API 인증 키 (LOG_COLLECTOR_API_KEY와 동일)
 * - STATS_DB: D1 데이터베이스 바인딩
 */

// CORS 헤더 설정
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

export default {
  async fetch(request, env) {
    // Preflight (OPTIONS) 요청 처리
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    const requestKey = request.headers.get('x-api-key');
    const PUT_KEY = env.PUT_KEY;

    try {
      // ==========================================
      // [GET] 모든 스니펫 다운로드 수 조회 (인증 불필요)
      // ==========================================
      if (request.method === 'GET') {
        const { results } = await env.STATS_DB.prepare(
          'SELECT id, downloads FROM snippet_stats ORDER BY downloads DESC',
        ).all();

        // { "스니펫ID": 다운로드수 } 형태로 변환
        const stats = {};
        for (const row of results) {
          stats[row.id] = row.downloads;
        }

        return new Response(JSON.stringify({ stats }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      // ==========================================
      // [POST] 다운로드 카운트 증가 (PUT_KEY 필요)
      // ==========================================
      if (request.method === 'POST') {
        if (requestKey !== PUT_KEY) {
          return new Response('Forbidden: Invalid API Key', {
            status: 403,
            headers: corsHeaders,
          });
        }

        const body = await request.json();
        const { snippetId } = body;

        if (!snippetId || typeof snippetId !== 'string') {
          return new Response('Bad Request: snippetId is required', {
            status: 400,
            headers: corsHeaders,
          });
        }

        const now = Date.now();

        // UPSERT: 존재하면 downloads +1, 없으면 새로 생성
        const { success } = await env.STATS_DB.prepare(
          `INSERT INTO snippet_stats (id, downloads, last_downloaded_at)
           VALUES (?, 1, ?)
           ON CONFLICT(id) DO UPDATE SET
             downloads = downloads + 1,
             last_downloaded_at = ?`,
        )
          .bind(snippetId, now, now)
          .run();

        if (!success) {
          return new Response('Database Error', {
            status: 500,
            headers: corsHeaders,
          });
        }

        return new Response(JSON.stringify({ success: true, snippetId }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders,
      });
    } catch (e) {
      console.error(e);
      return new Response('Internal Server Error: ' + e.message, {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
