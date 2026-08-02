// We'll use a simpler script to just replace the AutomationManager constructor signature in the source to support both options object and positional params.
// The PR explicitly states:
// "as 타입 단언 0개 — 컴파일러가 모든 타입을 검증"
// "typeof 런타임 분기 제거 — 어떤 필드가 뭔지 이름으로 자명"
// "호출부가 자기 문서화됨 (named parameters)"

// So we MUST change all callers.
// Let's use ts-morph.
