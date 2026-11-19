/**
 * Limita tentativas de login com FALHA por IP numa janela de tempo.
 * Complementa o bloqueio por conta (usuarios.tentativas_falhas): impede que
 * um mesmo computador teste senhas em muitos logins diferentes.
 *
 * Em memória: suficiente para um único processo no servidor local. Reiniciar
 * o servidor zera os contadores (o bloqueio por conta, no banco, continua).
 */
export class LimitadorDeTentativas {
  private readonly registros = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now,
  ) {}

  private recentes(chave: string): number[] {
    const limite = this.agora() - this.janelaMs;
    const lista = (this.registros.get(chave) ?? []).filter((t) => t > limite);
    if (lista.length) this.registros.set(chave, lista);
    else this.registros.delete(chave);
    return lista;
  }

  /** Segundos até poder tentar de novo, ou 0 se está liberado. */
  segundosParaLiberar(chave: string): number {
    const lista = this.recentes(chave);
    if (lista.length < this.maximo) return 0;
    const maisAntiga = lista[0] ?? this.agora();
    return Math.max(1, Math.ceil((maisAntiga + this.janelaMs - this.agora()) / 1000));
  }

  registrarFalha(chave: string): void {
    const lista = this.recentes(chave);
    lista.push(this.agora());
    this.registros.set(chave, lista);
  }

  limpar(chave: string): void {
    this.registros.delete(chave);
  }

  /** Zera todos os contadores (testes). */
  limparTudo(): void {
    this.registros.clear();
  }

  /** Remove entradas vencidas (chamado periodicamente). */
  faxina(): void {
    for (const chave of [...this.registros.keys()]) this.recentes(chave);
  }
}
