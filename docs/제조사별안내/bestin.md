## 현대아이파크
## references:
[요거님 정리자료](https://yogyui.tistory.com/category/%ED%99%88%EB%84%A4%ED%8A%B8%EC%9B%8C%ED%81%AC%28IoT%29/%EA%B4%91%EA%B5%90%EC%95%84%EC%9D%B4%ED%8C%8C%ED%81%AC)
[halwin님 컴포넌트 deepwiki](https://deepwiki.com/lunDreame/ha-bestin)


gen1 aio gen2 등 다양한 버전이 있는걸로보임

## 기본구조:

| 0 | 1 | 2 | 3 | 4 | 5 | ...| length|
|---|---|---|---|---|---|---|---|
|prefix |header(기기별)| length |request/response| sequence_number |data..| ...|checksum|
|0x02|0x28: 난방 <br> 0xD1 에너지 사용량<br>0x5x aio 방별 장치<br> 0x3x gen1,2 방별 장치

가스밸브, 도어락, 환기장치의 경우는 10바이트로 길이가 고정이고 구조가 다르다. 
| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
|prefix |header(기기별)| request/response| sequence_number |data..| ...|...|...|...|checksum|
|0x02|0x31: Gas 밸브<br>0x41: 도어락<br>0x61: Fan|
