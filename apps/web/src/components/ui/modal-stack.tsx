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

interface ModalStackContextValue {
  push: (id: string) => void
  remove: (id: string) => void
  topId: string | null
}

const ModalStackContext = createContext<ModalStackContextValue | null>(null)

export function ModalStackProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<string[]>([])

  const push = useCallback((id: string) => {
    setStack((s) => (s.includes(id) ? s : [...s, id]))
  }, [])

  const remove = useCallback((id: string) => {
    setStack((s) => s.filter((x) => x !== id))
  }, [])

  const value = useMemo<ModalStackContextValue>(
    () => ({ push, remove, topId: stack.length ? stack[stack.length - 1] : null }),
    [push, remove, stack],
  )

  return (
    <ModalStackContext.Provider value={value}>
      {children}
    </ModalStackContext.Provider>
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
  const ctx = useContext(ModalStackContext)
  const id = useId()

  useEffect(() => {
    if (!ctx || !open) return
    ctx.push(id)
    return () => ctx.remove(id)
  }, [open, id, ctx])

  // `open === undefined` → Dialog não controlado: não participa da pilha.
  const visible = !ctx || open === undefined ? true : ctx.topId === id
  return { visible }
}
