# Music provider reference

The music registry uses stable provider IDs and a shared bounded polling
adapter. Provider credentials are resolved server-side from the configured
provider key or request-scoped credentials. The adapter never logs credential
values.

Asynchronous providers use explicit status contracts:

- `mubert`: `GET /api/v3/public/tracks/{id}`
- `mureka`: `GET /v1/song/query/{task_id}`
- `apiframe`: `GET /v2/jobs/{id}`
- `kie-suno`: `GET /api/v1/generate/record-info?taskId={id}`
- `ace-suno`: `POST /suno/tasks` with `action: retrieve`
- `musicapi`: `GET /api/v1/sonic/task/{id}`
- `udioapi`: `GET /api/v2/feed?workId={id}`
- `apipass-suno`: `GET /api/v1/jobs/recordInfo?taskId={id}`

| Provider ID        | Environment variable     | Default catalog examples                            |
| ------------------ | ------------------------ | --------------------------------------------------- |
| `google-lyria`     | `GOOGLE_API_KEY`         | `lyria-3-clip-preview`, `lyria-3.5`                 |
| `elevenlabs-music` | `ELEVENLABS_API_KEY`     | `music_v1`                                          |
| `mureka`           | `MUREKA_API_KEY`         | `auto`, `mureka-v7.5`, `mureka-o1`                  |
| `stability-audio`  | `STABILITY_API_KEY`      | `stable-audio-2.5`                                  |
| `mubert`           | `MUBERT_ACCESS_TOKEN`    | `mubert-public`                                     |
| `apiframe`         | `APIFRAME_API_KEY`       | `suno`, `udio`, `producer`, `mureka`, `lyria-3-pro` |
| `kie-suno`         | `KIE_API_KEY`            | `suno-v5.5`                                         |
| `ace-suno`         | `ACE_DATA_CLOUD_API_KEY` | `suno`                                              |
| `musicapi`         | `MUSICAPI_API_KEY`       | `sonic-v5`, `producer`, `studio`, `riffusion`       |
| `udioapi`          | `UDIOAPI_API_KEY`        | `chirp-v5-5`, `chirp-v6-mini`, `chirp-v6-wild`      |
| `apipass-suno`     | `APIPASS_API_KEY`        | `V6`, `V6_MINI`, `V6_WILD`                          |
| `sunor`            | `SUNOR_API_KEY`          | `suno`, `udio`                                      |

Mubert also accepts explicit `providerCredentials` fields such as
`customerId` and `accessToken`. Use `POST /music` with `lyrics`, `duration`,
`instrumental`, `seed`, and a namespaced `providerOptions` object for provider
controls. Tests use `mock-music-v1` and do not require live credentials.
