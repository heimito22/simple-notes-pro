import { Stack } from 'expo-router';
import React from 'react';
import AlarmeOverlay from '../components/alarme-overlay';
import { ListaProvider } from '../context/ListaContext'; // <-- Com chaves {}
import { MonetizacaoProvider } from '../context/monetizacao';
import { NotasProvider } from '../context/NotasContext';
import TarefasProvider from '../context/TarefasContext';
import ThemeProvider from '../context/ThemeContext';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <MonetizacaoProvider>
        <TarefasProvider>
          <ListaProvider> 
            <NotasProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="editor" options={{ presentation: 'modal' }} />
                <Stack.Screen name="editorL" options={{ presentation: 'modal' }} />
                <Stack.Screen name="permissoes" options={{ presentation: 'modal' }} />
              </Stack>
              <AlarmeOverlay />
            </NotasProvider>
          </ListaProvider>
        </TarefasProvider>
      </MonetizacaoProvider>
    </ThemeProvider>
  );
}