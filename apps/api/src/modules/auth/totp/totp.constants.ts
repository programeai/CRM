/** Passo de 30s: o default e o recomendado pela RFC 6238 §4.2/§5.2. */
export const PASSO_SEGUNDOS = 30;

/**
 * Tolerância de drift, em SEGUNDOS (é a unidade que o `otplib` v13 usa em
 * `epochTolerance`). 30s = **um** passo para cada lado, e não mais: *"We
 * RECOMMEND that at most one time step is allowed as the network delay"*
 * (RFC 6238 §5.2). A doc do `otplib` marca janela grande como *"UNSAFE: Large
 * verification windows allow replay attacks"*.
 *
 * O default do `otplib` v13 é **zero** — sem esta constante, um código de 29
 * segundos atrás seria recusado, o que reprovaria uso legítimo.
 *
 * Contradição conhecida e decidida: a ASVS 5.0 6.5.5 pede "maximum lifetime of
 * 30 seconds" para TOTP, o que lido ao pé da letra proibiria tolerância nenhuma.
 * Seguimos a RFC, porque tolerância zero reprova relógio de celular com poucos
 * segundos de atraso — e o que a ASVS quer proteger (janela de uso do código) é
 * garantido pelo `lastUsedStep`, que já impede o segundo uso.
 */
export const TOLERANCIA_SEGUNDOS = PASSO_SEGUNDOS;

/**
 * 16 códigos, uso único — o comportamento documentado e verificável do GitHub.
 * (Google usa 10; GitLab, 10; Keycloak, 12.)
 */
export const QUANTIDADE_DE_CODIGOS = 16;

/**
 * Bytes de entropia por código de recuperação. 16 bytes = **128 bits**, acima do
 * piso de 112 bits da ASVS 6.5.2 — e é isso que torna o hash rápido (sha256)
 * defensável por norma: *"A standard hash function can be used if the secret has
 * 112 bits of entropy or more."* Abaixo de 112 seria obrigatório KDF salgado, que
 * a cada palpite errado custaria N derivações (o DoS por exaustão de CPU que a
 * OWASP nomeia, e que o `devise-two-factor` do GitLab tem por desenho).
 *
 * Também está acima do mínimo de 64 bits do NIST SP 800-63B para código de
 * recuperação salvo.
 */
export const BYTES_DO_CODIGO = 16;

/**
 * Falhas consecutivas antes da trava. A NIST SP 800-63B põe o teto em 100
 * tentativas falhas consecutivas por conta; 10 é bem mais apertado, e o
 * suficiente para quem errou de digitação não se ver travado.
 */
export const MAX_FALHAS = 10;

/** Duração da trava temporária, em minutos. */
export const TRAVA_MINUTOS = 15;

/** O `issuer` do `otpauth://` — é o nome que aparece no app autenticador. */
export const EMISSOR = 'ProgrameAi CRM';
