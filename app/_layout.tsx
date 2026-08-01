import { Stack } from 'expo-router';
import React from 'react';
import { ListaProvider } from '../context/ListaContext'; // <-- Com chaves {}
import { NotasProvider } from '../context/NotasContext';
import TarefasProvider from '../context/TarefasContext';
import ThemeProvider from '../context/ThemeContext';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <TarefasProvider>
        <ListaProvider> 
          <NotasProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="editor" options={{ presentation: 'modal' }} />
              <Stack.Screen name="editorL" options={{ presentation: 'modal' }} />
            </Stack>
          </NotasProvider>
        </ListaProvider>
      </TarefasProvider>
    </ThemeProvider>
  );
}