/**
 * Texto rico das respostas da IA no celular: **negrito**, *itálico*, listas,
 * títulos, citações, código e cores no formato [cor=#RRGGBB]texto[/cor].
 * É usado no chat dedicado (app/ia.tsx) e no painel da IA do editor.
 */
import React from 'react';
import { Platform, StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';

function inlineRico(texto: string, chave: string): React.ReactNode[] {
    const nos: React.ReactNode[] = [];
    const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[cor=(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\][\s\S]*?\[\/cor\])/g;
    let ultimo = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(texto))) {
        if (m.index > ultimo) nos.push(texto.slice(ultimo, m.index));
        const tok = m[0];
        const k = `${chave}-${i++}`;
        const cor = tok.match(/^\[cor=(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\]([\s\S]*)\[\/cor\]$/);
        if (cor) {
            nos.push(<Text key={k} style={{ color: cor[1], fontWeight: '600' }}>{inlineRico(cor[2], k)}</Text>);
        } else if (tok.startsWith('**')) {
            nos.push(<Text key={k} style={{ fontWeight: '700' }}>{tok.slice(2, -2)}</Text>);
        } else if (tok.startsWith('*')) {
            nos.push(<Text key={k} style={{ fontStyle: 'italic' }}>{tok.slice(1, -1)}</Text>);
        } else if (tok.startsWith('~~')) {
            nos.push(<Text key={k} style={{ textDecorationLine: 'line-through' }}>{tok.slice(2, -2)}</Text>);
        } else if (tok.startsWith('`')) {
            nos.push(<Text key={k} style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{tok.slice(1, -1)}</Text>);
        }
        ultimo = m.index + tok.length;
    }
    if (ultimo < texto.length) nos.push(texto.slice(ultimo));
    return nos;
}

export default function TextoRico({ texto, cor, estilo, corDestaque }: {
    texto: string;
    cor: string;
    estilo?: StyleProp<TextStyle>;
    corDestaque?: string;
}) {
    const base: StyleProp<TextStyle> = [styles.texto, estilo, { color: cor }];
    const linhas = String(texto || '').replace(/\r/g, '').split('\n');
    const blocos: React.ReactNode[] = [];
    let lista: string[] = [];
    let tipoLista = '';
    let codigo: string[] | null = null;
    let seq = 0;
    const fechaLista = () => {
        if (!lista.length) return;
        blocos.push(
            <View key={`l${seq++}`} style={{ marginVertical: 2 }}>
                {lista.map((item, idx) => (
                    <Text key={idx} style={[base, { paddingLeft: 10 }]}>
                        {tipoLista === 'ol' ? `${idx + 1}. ` : '• '}
                        {inlineRico(item, `li${seq}-${idx}`)}
                    </Text>
                ))}
            </View>
        );
        lista = [];
        tipoLista = '';
    };
    const fechaCodigo = () => {
        if (codigo === null) return;
        blocos.push(
            <Text key={`c${seq++}`} style={[base, styles.codigoBloco]}>
                {codigo.join('\n')}
            </Text>
        );
        codigo = null;
    };
    for (const linha of linhas) {
        if (linha.trim().startsWith('```')) {
            if (codigo === null) { fechaLista(); codigo = []; }
            else fechaCodigo();
            continue;
        }
        if (codigo !== null) { codigo.push(linha); continue; }
        const t = linha.trim();
        if (!t) { fechaLista(); blocos.push(<View key={`e${seq++}`} style={{ height: 6 }} />); continue; }
        const titulo = t.match(/^(#{1,3})\s+(.*)$/);
        if (titulo) {
            fechaLista();
            blocos.push(
                <Text key={`h${seq++}`} style={[base, { fontWeight: '700', fontSize: 16, marginTop: 4 }]}>
                    {inlineRico(titulo[2], `h${seq}`)}
                </Text>
            );
            continue;
        }
        if (/^\*\*[^*]+\*\*$/.test(t)) {
            fechaLista();
            blocos.push(
                <Text key={`h${seq++}`} style={[base, { fontWeight: '700', marginTop: 3 }]}>
                    {inlineRico(t, `h${seq}`)}
                </Text>
            );
            continue;
        }
        const item = t.match(/^[-*•]\s+(.*)$/);
        if (item) {
            if (tipoLista !== 'ul') { fechaLista(); tipoLista = 'ul'; }
            lista.push(item[1]);
            continue;
        }
        const numerado = t.match(/^\d+[.)]\s+(.*)$/);
        if (numerado) {
            if (tipoLista !== 'ol') { fechaLista(); tipoLista = 'ol'; }
            lista.push(numerado[1]);
            continue;
        }
        fechaLista();
        const citacao = t.match(/^>\s*(.*)$/);
        if (citacao) {
            blocos.push(
                <View key={`q${seq++}`} style={[styles.citacao, { borderLeftColor: corDestaque || '#0A84FF' }]}>
                    <Text style={base}>{inlineRico(citacao[1], `q${seq}`)}</Text>
                </View>
            );
            continue;
        }
        blocos.push(
            <Text key={`p${seq++}`} style={base}>
                {inlineRico(t, `p${seq}`)}
            </Text>
        );
    }
    fechaLista();
    fechaCodigo();
    return <View>{blocos}</View>;
}

const styles = StyleSheet.create({
    texto: { fontSize: 15, lineHeight: 21 },
    codigoBloco: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 13, lineHeight: 19,
        backgroundColor: 'rgba(127,127,127,0.14)',
        borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7,
        marginVertical: 4,
    },
    citacao: {
        borderLeftWidth: 3,
        paddingLeft: 10, marginVertical: 3,
        opacity: 0.92,
    },
});
