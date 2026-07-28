import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react"

/**
 * Pilha global de modais — impõe a regra "nunca um modal sobre outro".
 *
 * Quando um modal abre sobre outro, o de baixo permanece **montado** (preservando
 * todo o estado de formulário) mas fica **soterrado**: apenas o topo da pilha é
 * visível. Ao fechar o modal do topo, o anterior volta ao topo e reaparece com
 * os dados intactos.
 *
 * A regra é aplicada automaticamente pelo primitivo `Dialog` (ver `dialog.tsx`),
 * que chama `useStackedModal` — nenhum consumidor precisa se preocupar com isso.
 */

interface ModalStackActions {
  push: (id: string) => void
  remove: (id: string) => void
}

/**
 * As AÇÕES e o TOPO vivem em contextos separados de propósito, e essa separação é
 * a correção de um bug real, não estilo.
 *
 * Num único contexto, `{ push, remove, topId }` é um objeto novo a cada mutação da
 * pilha. O efeito de `useStackedModal` depende dele, então: abrir um modal empurra
 * o id → a pilha vira outro array → o contexto vira outro objeto → o efeito roda
 * de novo → o cleanup remove o id e o setup o empurra de volta → a pilha vira
 * outro array... e o React roda até estourar em "Maximum update depth exceeded".
 * Com as ações num contexto de identidade ESTÁVEL (memo sem dependências), o
 * efeito passa a rodar só quando `open` muda de verdade.
 */
const ModalStackActionsContext = createContext<ModalStackActions | null>(null)
const ModalStackTopContext = createContext<string | null>(null)

export function ModalStackProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<string[]>([])

  const push = useCallback((id: string) => {
    setStack((s) => (s.includes(id) ? s : [...s, id]))
  }, [])

  const remove = useCallback((id: string) => {
    setStack((s) => s.filter((x) => x !== id))
  }, [])

  // Sem dependências além dos dois callbacks estáveis: esta identidade nunca muda.
  const actions = useMemo<ModalStackActions>(() => ({ push, remove }), [push, remove])
  const topId = stack.length ? stack[stack.length - 1] : null

  return (
    <ModalStackActionsContext.Provider value={actions}>
      <ModalStackTopContext.Provider value={topId}>
        {children}
      </ModalStackTopContext.Provider>
    </ModalStackActionsContext.Provider>
  )
}

/**
 * Registra o modal na pilha enquanto `open` for `true` e informa se ele é o topo
 * (visível). Modais soterrados devem manter `open` lógico verdadeiro (para não
 * desmontar/reiniciar o formulário) e apenas ocultar o Dialog visualmente.
 *
 * Sem provider (fallback), o modal é sempre visível — nada quebra.
 */
export function useStackedModal(open: boolean | undefined): { visible: boolean } {
  const actions = useContext(ModalStackActionsContext)
  const topId = useContext(ModalStackTopContext)
  const id = useId()

  useEffect(() => {
    if (!actions || !open) return
    actions.push(id)
    return () => actions.remove(id)
  }, [open, id, actions])

  // `open === undefined` → Dialog não controlado: não participa da pilha.
  // `topId === null` cobre o primeiro render de um modal que abre: o `push` só
  // acontece no efeito, e sem isso o primitivo receberia `open=false` no render
  // em que deveria abrir.
  const visible =
    !actions || open === undefined ? true : topId === null || topId === id
  return { visible }
}
