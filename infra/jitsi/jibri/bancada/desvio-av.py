#!/usr/bin/env python3
"""O desvio entre o audio e a imagem de uma gravacao da bancada no modo av (docs/30 A65).

O video de teste tem, a cada segundo, um clarao branco na tela inteira e um bipe, os dois nos primeiros 100 ms. O
medir.sh tira do arquivo gravado dois textos com o ffmpeg da imagem e os passa aqui:
  desvio-av.py <claroes.txt> <bipes.txt>
- claroes.txt: a saida do filtro signalstats (pts_time e YAVG de cada quadro, reduzido): o clarao comeca quando a media
  de luz passa de 190;
- bipes.txt: a saida do filtro silencedetect: cada "silence_end" e o comeco de um bipe.
Para cada clarao, o bipe mais perto (ate meio segundo). Imprime uma linha com o desvio mediano, em milissegundos, no
comeco, no meio e no fim do arquivo: negativo = o audio vem antes da imagem (adiantado). Um desvio igual nos tres e
fixo; um que cresce e a imagem e o audio andando em ritmos diferentes.
"""
import re
import sys


def median(values):
    ordered = sorted(values)
    return ordered[len(ordered) // 2] if ordered else float("nan")


def main():
    frames = re.findall(r"pts_time:([0-9.]+)\s*\n?lavfi\.signalstats\.YAVG=([0-9.]+)", open(sys.argv[1], errors="replace").read())
    flashes, bright = [], False
    for when, light in frames:
        now = float(light) > 190
        if now and not bright:
            flashes.append(float(when))
        bright = now
    beeps = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", open(sys.argv[2], errors="replace").read())]

    pairs = []
    for flash in flashes:
        if not beeps:
            break
        beep = min(beeps, key=lambda x: abs(x - flash))
        if abs(beep - flash) < 0.5:
            pairs.append((flash, (beep - flash) * 1000))

    count = len(pairs)
    if count < 6:
        print("claroes=%d bipes=%d pares=%d (poucos para medir)" % (len(flashes), len(beeps), count))
        return
    third = max(2, count // 3)
    print(
        "claroes=%d bipes=%d pares=%d av_inicio_ms=%.0f av_meio_ms=%.0f av_fim_ms=%.0f (de %.0f s a %.0f s do arquivo)"
        % (
            len(flashes),
            len(beeps),
            count,
            median([offset for _, offset in pairs[:third]]),
            median([offset for _, offset in pairs[third : count - third]]),
            median([offset for _, offset in pairs[count - third :]]),
            pairs[0][0],
            pairs[-1][0],
        )
    )


if __name__ == "__main__":
    main()
